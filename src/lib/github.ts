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
const PER_REPO_DEADLINE_MS = 35_000;
const ORG_DEADLINE_MS = 55_000;

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
        ? "GitHub still computing stats (HTTP 202) past deadline"
        : "Deadline reached before GitHub responded with data";
    const message =
      outcome.lastStatus === 202
        ? "GitHub returned HTTP 202 (cache warming) on every retry. The server is now warming this repo in the background — hit Retry in ~30-60s."
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

class RepoFetchFailure extends Error {
  outcome: Exclude<FetchOutcome, { kind: "ok" }>;
  constructor(repoFullName: string, outcome: Exclude<FetchOutcome, { kind: "ok" }>) {
    super(`Repo fetch failed: ${repoFullName}`);
    this.outcome = outcome;
    this.name = "RepoFetchFailure";
  }
}

// Fetches a single repo's race, with its own deadline. SUCCESS is what gets
// cached by unstable_cache; FAILURES throw RepoFetchFailure (which Next.js
// does not cache), so the next call retries them automatically.
async function fetchRepoRaceUncached(
  org: string,
  repoName: string,
  isPrivate: boolean,
  htmlUrl: string,
  sinceISO: string,
  untilISO: string
): Promise<RepoRace | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Server is missing the GITHUB_TOKEN environment variable.");
  const octokit = new Octokit({ auth: token });
  const sinceTs = Math.floor(new Date(sinceISO).getTime() / 1000);
  const untilTs = Math.floor(new Date(untilISO).getTime() / 1000);
  const deadline = Date.now() + PER_REPO_DEADLINE_MS;
  const outcome = await fetchContribStats(octokit, org, repoName, deadline);
  if (outcome.kind !== "ok") {
    throw new RepoFetchFailure(`${org}/${repoName}`, outcome);
  }
  const racers = aggregateWeeks(outcome.data, sinceTs, untilTs);
  const totalAdditions = racers.reduce((s, r) => s + r.additions, 0);
  const totalDeletions = racers.reduce((s, r) => s + r.deletions, 0);
  const totalCommits = racers.reduce((s, r) => s + r.commits, 0);
  if (totalCommits === 0 && totalAdditions === 0) return null;
  return {
    name: repoName,
    fullName: `${org}/${repoName}`,
    htmlUrl,
    private: isPrivate,
    totalAdditions,
    totalDeletions,
    totalCommits,
    racers,
  };
}

// Per-repo cache. Cache key = org + repoName + sinceISO + untilISO.
// Successful results (RepoRace OR null for empty repos) cached for 1h.
// Thrown RepoFetchFailure is NOT cached, so the same repo gets retried
// next request — exactly what we want for GitHub's 202 lazy cache.
const cachedFetchRepoRace = unstable_cache(
  fetchRepoRaceUncached,
  ["repo-race-v1"],
  { revalidate: 60 * 60, tags: ["github-code-race"] }
);

type RepoListing = {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  pushed_at: string | null;
};

async function listOrgReposUncached(org: string): Promise<RepoListing[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Server is missing the GITHUB_TOKEN environment variable.");
  const octokit = new Octokit({ auth: token });
  const repos = await octokit.paginate("GET /orgs/{org}/repos", {
    org,
    type: "all",
    per_page: 100,
    sort: "pushed",
  });
  return repos as RepoListing[];
}

const cachedListOrgRepos = unstable_cache(listOrgReposUncached, ["org-repos-v1"], {
  revalidate: 10 * 60,
  tags: ["github-code-race"],
});

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
}): Promise<RaceData> {
  const { org, since, until } = opts;
  const sinceISO = since.toISOString();
  const untilISO = until.toISOString();

  const allRepos = await cachedListOrgRepos(org);
  const candidates = allRepos.filter((r) => {
    if (r.archived) return false;
    if (!r.pushed_at) return false;
    const pushed = new Date(r.pushed_at).getTime();
    if (pushed < since.getTime()) return false;
    return true;
  });

  const warnings: Warning[] = [];
  const repoRaces: RepoRace[] = [];
  const orgDeadlineMs = Date.now() + ORG_DEADLINE_MS;

  await withConcurrency(candidates, 6, async (repo) => {
    if (Date.now() >= orgDeadlineMs) {
      warnings.push({
        repo: repo.full_name,
        reason: "Skipped — request deadline reached before this repo was attempted",
        message: "Hit Retry to fetch the missing repos. Successful repos are served from cache.",
        attempts: 0,
        lastStatus: null,
      });
      return;
    }
    try {
      const result = await cachedFetchRepoRace(
        org,
        repo.name,
        repo.private,
        repo.html_url,
        sinceISO,
        untilISO
      );
      if (result) repoRaces.push(result);
    } catch (err: unknown) {
      if (err instanceof RepoFetchFailure) {
        warnings.push(buildWarning(err.message.replace("Repo fetch failed: ", ""), err.outcome));
        return;
      }
      // Sometimes class identity gets stripped through unstable_cache; duck-type fallback.
      const outcome = (err as { outcome?: Exclude<FetchOutcome, { kind: "ok" }> }).outcome;
      if (outcome) {
        warnings.push(buildWarning(repo.full_name, outcome));
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      warnings.push({
        repo: repo.full_name,
        reason: "Unexpected error",
        message,
        attempts: 0,
        lastStatus: null,
      });
    }
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

export async function getCachedOrgRaceData(
  org: string,
  since: Date,
  until: Date
): Promise<RaceData> {
  // No top-level cache: per-repo entries already cache the expensive parts,
  // and we don't want failed-repo warnings to be cached at the org level
  // (they should re-fetch on every retry).
  return getOrgRaceData({ org, since, until });
}

// Fire-and-forget warmer: keeps poking GitHub's /stats/contributors for the
// repos that came back as 202 in the user-facing race, so the next race finds
// GitHub's cache hot. Runs inside Next.js `after()`. Returns the list of
// repos that actually became ready during the warm window.
export async function warmFailedRepos(
  org: string,
  repoNames: string[],
  budgetMs: number
): Promise<{ ready: string[]; stillCold: string[] }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ready: [], stillCold: repoNames };
  const octokit = new Octokit({ auth: token });
  const deadline = Date.now() + budgetMs;
  const ready: string[] = [];
  const stillCold: string[] = [];
  await Promise.all(
    repoNames.map(async (repoName) => {
      while (Date.now() < deadline) {
        try {
          const res = await octokit.request("GET /repos/{owner}/{repo}/stats/contributors", {
            owner: org,
            repo: repoName,
          });
          if (res.status !== 202) {
            ready.push(repoName);
            return;
          }
        } catch {
          stillCold.push(repoName);
          return;
        }
        if (Date.now() + 4000 >= deadline) break;
        await sleep(4000);
      }
      stillCold.push(repoName);
    })
  );
  return { ready, stillCold };
}
