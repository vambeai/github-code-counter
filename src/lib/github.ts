import { Octokit } from "@octokit/rest";
import type { Racer, RaceData, RepoRace } from "./types";

type ContribWeek = { w: number; a: number; d: number; c: number };
type ContribStat = {
  total: number;
  weeks: ContribWeek[];
  author: { login: string; avatar_url: string; html_url: string } | null;
};

const WEEK_SECONDS = 7 * 24 * 60 * 60;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// GitHub computes /stats/contributors lazily. The first request for a repo
// returns 202 and kicks off a background job. We retry until either the data
// is ready or we hit the request-wide deadline (so we always return JSON
// before Vercel times out the function and serves a plaintext error).
async function fetchContribStats(
  octokit: Octokit,
  owner: string,
  repo: string,
  deadlineMs: number
): Promise<ContribStat[] | null> {
  const MAX_ATTEMPTS = 12;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (Date.now() >= deadlineMs) return null;
    try {
      const res = await octokit.request("GET /repos/{owner}/{repo}/stats/contributors", {
        owner,
        repo,
      });
      if (res.status === 202) {
        const wait = 2000 + attempt * 400;
        if (Date.now() + wait >= deadlineMs) return null;
        await sleep(wait);
        continue;
      }
      if (!Array.isArray(res.data)) return [];
      return res.data as unknown as ContribStat[];
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 204 || status === 409) return [];
      if (status === 404 || status === 403) throw err;
      if (attempt === MAX_ATTEMPTS - 1) throw err;
      if (Date.now() + 800 >= deadlineMs) return null;
      await sleep(800);
    }
  }
  return null;
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
  pushedSinceFilter?: boolean;
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

  const warnings: string[] = [];
  const repoRaces: RepoRace[] = [];

  // Soft deadline ~5s under Vercel's maxDuration so we always return JSON
  // (with partial results + warnings) instead of a plaintext timeout page.
  const deadlineMs = Date.now() + 55_000;

  await withConcurrency(candidates, 6, async (repo) => {
    if (Date.now() >= deadlineMs) {
      warnings.push(
        `${repo.full_name}: skipped (request deadline reached). Hit START again — anything that was computing should be ready now.`
      );
      return;
    }
    try {
      const stats = await fetchContribStats(octokit, org, repo.name, deadlineMs);
      if (stats === null) {
        warnings.push(
          `${repo.full_name}: GitHub is still building its contributor cache (first-time hit). Hit START again in ~30s and it'll be ready.`
        );
        return;
      }
      const racers = aggregateWeeks(stats, sinceTs, untilTs);
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
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const msg = err instanceof Error ? err.message : "unknown error";
      warnings.push(`${repo.full_name}: ${status ?? ""} ${msg}`.trim());
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
