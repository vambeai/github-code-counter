import { Octokit } from "@octokit/rest";
import { unstable_cache } from "next/cache";
import type { Racer, RaceData, RepoRace, Warning } from "./types";

type ContribWeek = { w: number; a: number; d: number; c: number };
type ContribStat = {
  total: number;
  weeks: ContribWeek[];
  author: { login: string; avatar_url: string; html_url: string } | null;
};

const WEEK_SECONDS = 7 * 24 * 60 * 60;

const RATE_LIMIT_HEADERS = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-used",
  "x-ratelimit-resource",
  "retry-after",
  "x-github-request-id",
  "x-github-media-type",
  "etag",
  "last-modified",
  "x-github-api-version-selected",
];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickHeaders(
  raw: Record<string, string | number | undefined> | undefined
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const key of RATE_LIMIT_HEADERS) {
    const v = raw[key];
    if (v !== undefined) out[key] = String(v);
  }
  return out;
}

type FetchOutcome =
  | {
      kind: "ok";
      data: ContribStat[];
      attempts: number;
      lastStatus: number;
      headers: Record<string, string>;
    }
  | {
      kind: "deadline";
      attempts: number;
      lastStatus: number | null;
      headers: Record<string, string>;
    }
  | {
      kind: "error";
      attempts: number;
      lastStatus: number | null;
      headers: Record<string, string>;
      message: string;
      rawBody?: string;
    };

// GitHub computes /stats/contributors lazily. The first request for a repo
// returns 202 and kicks off a background job. We retry until either the data
// is ready or we hit the request-wide deadline. This function records the
// last status, attempts and response headers so callers can build detailed
// warnings (rate-limit, request-id, etc.) for failed repos.
async function fetchContribStats(
  octokit: Octokit,
  owner: string,
  repo: string,
  deadlineMs: number
): Promise<FetchOutcome> {
  const MAX_ATTEMPTS = 12;
  let attempts = 0;
  let lastStatus: number | null = null;
  let lastHeaders: Record<string, string> = {};
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    attempts = attempt + 1;
    if (Date.now() >= deadlineMs) {
      return { kind: "deadline", attempts, lastStatus, headers: lastHeaders };
    }
    try {
      const res = await octokit.request("GET /repos/{owner}/{repo}/stats/contributors", {
        owner,
        repo,
      });
      lastStatus = res.status;
      lastHeaders = pickHeaders(
        res.headers as Record<string, string | number | undefined>
      );
      if (res.status === 202) {
        const wait = 2000 + attempt * 400;
        if (Date.now() + wait >= deadlineMs) {
          return { kind: "deadline", attempts, lastStatus, headers: lastHeaders };
        }
        await sleep(wait);
        continue;
      }
      const data = (Array.isArray(res.data) ? res.data : []) as unknown as ContribStat[];
      return { kind: "ok", data, attempts, lastStatus, headers: lastHeaders };
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? null;
      const respHeaders =
        (err as { response?: { headers?: Record<string, string | number | undefined> } })
          .response?.headers;
      const respBody = (err as { response?: { data?: unknown } }).response?.data;
      lastStatus = status;
      if (respHeaders) lastHeaders = pickHeaders(respHeaders);
      if (status === 204 || status === 409) {
        return { kind: "ok", data: [], attempts, lastStatus: status, headers: lastHeaders };
      }
      const message = err instanceof Error ? err.message : "unknown error";
      const rawBody =
        respBody === undefined
          ? undefined
          : typeof respBody === "string"
            ? respBody.slice(0, 1000)
            : JSON.stringify(respBody).slice(0, 1000);
      if (status === 404 || status === 403 || status === 401 || status === 451) {
        return {
          kind: "error",
          attempts,
          lastStatus: status,
          headers: lastHeaders,
          message,
          rawBody,
        };
      }
      if (attempt === MAX_ATTEMPTS - 1) {
        return {
          kind: "error",
          attempts,
          lastStatus: status,
          headers: lastHeaders,
          message,
          rawBody,
        };
      }
      if (Date.now() + 800 >= deadlineMs) {
        return { kind: "deadline", attempts, lastStatus, headers: lastHeaders };
      }
      await sleep(800);
    }
  }
  return { kind: "deadline", attempts, lastStatus, headers: lastHeaders };
}

function buildWarning(
  repoFullName: string,
  outcome: Exclude<FetchOutcome, { kind: "ok" }>
): Warning {
  const headers = outcome.headers;
  const rateLimit = {
    limit: headers["x-ratelimit-limit"],
    remaining: headers["x-ratelimit-remaining"],
    reset: headers["x-ratelimit-reset"],
    used: headers["x-ratelimit-used"],
    resource: headers["x-ratelimit-resource"],
  };
  const requestId = headers["x-github-request-id"];

  if (outcome.kind === "deadline") {
    const reason =
      outcome.lastStatus === 202
        ? "GitHub still computing stats (HTTP 202) past our 55s deadline"
        : "Deadline reached before GitHub responded with data";
    const message =
      outcome.lastStatus === 202
        ? "GitHub returned HTTP 202 (cache warming) on every retry. Hit START again — large repos can take >1 min on first hit; subsequent runs are instant."
        : `Last seen status: ${outcome.lastStatus ?? "n/a"} after ${outcome.attempts} attempts.`;
    return {
      repo: repoFullName,
      reason,
      message,
      attempts: outcome.attempts,
      lastStatus: outcome.lastStatus,
      rateLimit,
      responseHeaders: headers,
      requestId,
    };
  }
  // error
  return {
    repo: repoFullName,
    reason: `GitHub returned HTTP ${outcome.lastStatus ?? "?"}`,
    message: outcome.message,
    attempts: outcome.attempts,
    lastStatus: outcome.lastStatus,
    rateLimit,
    responseHeaders: headers,
    rawBody: outcome.rawBody,
    requestId,
  };
}

function aggregateWeeks(stats: ContribStat[], sinceTs: number, untilTs: number): Racer[] {
  return stats
    .map((s) => {
      let additions = 0;
      let deletions = 0;
      let commits = 0;
      for (const w of s.weeks) {
        const weekStart = w.w;
        const weekEnd = w.w + WEEK_SECONDS;
        if (weekEnd <= sinceTs || weekStart >= untilTs) continue;
        const overlapStart = Math.max(weekStart, sinceTs);
        const overlapEnd = Math.min(weekEnd, untilTs);
        const overlap = (overlapEnd - overlapStart) / WEEK_SECONDS;
        additions += Math.round(w.a * overlap);
        deletions += Math.round(w.d * overlap);
        commits += Math.round(w.c * overlap);
      }
      return {
        login: s.author?.login ?? "ghost",
        avatarUrl: s.author?.avatar_url ?? "",
        htmlUrl: s.author?.html_url ?? "#",
        additions,
        deletions,
        commits,
      } satisfies Racer;
    })
    .filter((r) => r.commits > 0 || r.additions > 0)
    .sort((a, b) => b.additions - a.additions);
}

async function listOrgRepos(octokit: Octokit, org: string) {
  return octokit.paginate("GET /orgs/{org}/repos", {
    org,
    type: "all",
    per_page: 100,
    sort: "pushed",
  });
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function getOrgRaceData(opts: {
  org: string;
  since: Date;
  until: Date;
  token: string;
}): Promise<RaceData> {
  const { org, since, until, token } = opts;
  const octokit = new Octokit({ auth: token });

  const sinceTs = Math.floor(since.getTime() / 1000);
  const untilTs = Math.floor(until.getTime() / 1000);

  const allRepos = (await listOrgRepos(octokit, org)) as Array<{
    name: string;
    full_name: string;
    html_url: string;
    private: boolean;
    archived: boolean;
    fork: boolean;
    pushed_at: string | null;
    size: number;
  }>;

  const candidates = allRepos.filter((r) => {
    if (r.archived) return false;
    if (!r.pushed_at) return false;
    const pushed = new Date(r.pushed_at).getTime();
    if (pushed < since.getTime()) return false;
    return true;
  });

  const warnings: Warning[] = [];
  const repoRaces: RepoRace[] = [];

  // Soft deadline ~5s under Vercel's maxDuration so we always return JSON
  // (with partial results + warnings) instead of a plaintext timeout page.
  const deadlineMs = Date.now() + 55_000;

  await withConcurrency(candidates, 6, async (repo) => {
    if (Date.now() >= deadlineMs) {
      warnings.push({
        repo: repo.full_name,
        reason: "Skipped — request deadline reached before this repo was attempted",
        message: "Hit START again to retry.",
        attempts: 0,
        lastStatus: null,
      });
      return;
    }
    const outcome = await fetchContribStats(octokit, org, repo.name, deadlineMs);
    if (outcome.kind !== "ok") {
      warnings.push(buildWarning(repo.full_name, outcome));
      return;
    }
    const racers = aggregateWeeks(outcome.data, sinceTs, untilTs);
    const totalAdditions = racers.reduce((s, r) => s + r.additions, 0);
    const totalDeletions = racers.reduce((s, r) => s + r.deletions, 0);
    const totalCommits = racers.reduce((s, r) => s + r.commits, 0);
    if (totalCommits === 0 && totalAdditions === 0) return;
    repoRaces.push({
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      private: repo.private,
      totalAdditions,
      totalDeletions,
      totalCommits,
      racers,
    });
  });

  repoRaces.sort((a, b) => b.totalAdditions - a.totalAdditions);

  const orgRacerMap = new Map<string, Racer>();
  for (const repoRace of repoRaces) {
    for (const r of repoRace.racers) {
      const existing = orgRacerMap.get(r.login);
      if (existing) {
        existing.additions += r.additions;
        existing.deletions += r.deletions;
        existing.commits += r.commits;
      } else {
        orgRacerMap.set(r.login, { ...r });
      }
    }
  }
  const orgRacers = Array.from(orgRacerMap.values()).sort((a, b) => b.additions - a.additions);
  const totalAdditions = orgRacers.reduce((s, r) => s + r.additions, 0);
  const totalDeletions = orgRacers.reduce((s, r) => s + r.deletions, 0);
  const totalCommits = orgRacers.reduce((s, r) => s + r.commits, 0);

  return {
    org,
    since: since.toISOString(),
    until: until.toISOString(),
    totalAdditions,
    totalDeletions,
    totalCommits,
    racers: orgRacers,
    repos: repoRaces,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

// 1h server-side cache. The token is read from env inside the cached function
// (not part of the cache key) so it doesn't leak into Vercel's data cache key.
// Cache key: org + sinceISO + untilISO. Different month/org = different entry.
const CACHE_TTL_SECONDS = 60 * 60;

const cachedFetcher = unstable_cache(
  async (org: string, sinceISO: string, untilISO: string): Promise<RaceData> => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Server is missing the GITHUB_TOKEN environment variable.");
    return getOrgRaceData({
      org,
      since: new Date(sinceISO),
      until: new Date(untilISO),
      token,
    });
  },
  ["github-code-race-v2"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["github-code-race"] }
);

export async function getCachedOrgRaceData(
  org: string,
  since: Date,
  until: Date
): Promise<RaceData> {
  return cachedFetcher(org, since.toISOString(), until.toISOString());
}
