import { Octokit } from "@octokit/rest";
import { unstable_cache } from "next/cache";
import type { Racer, RaceData, RepoRace, Warning } from "./types";

// Per-repo deadline covers up to ~20 pages of 100 commits via GraphQL. For
// typical org repos that's well over a month's worth of commits.
const PER_REPO_DEADLINE_MS = 12_000;
const ORG_DEADLINE_MS = 50_000;
const MAIN_CONCURRENCY = 6;
const MAX_PAGES_PER_REPO = 20;

type CommitNode = {
  oid: string;
  additions: number;
  deletions: number;
  committedDate: string;
  author: {
    user: { login: string; avatarUrl: string; url: string } | null;
    name: string | null;
    email: string | null;
  } | null;
};

type HistoryPage = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: CommitNode[];
};

type GraphQLResponse = {
  repository: {
    defaultBranchRef: {
      target: {
        history: HistoryPage;
      } | null;
    } | null;
  } | null;
};

const COMMIT_HISTORY_QUERY = /* GraphQL */ `
  query CommitHistory(
    $owner: String!
    $name: String!
    $since: GitTimestamp!
    $until: GitTimestamp!
    $cursor: String
  ) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(since: $since, until: $until, first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                oid
                additions
                deletions
                committedDate
                author {
                  user {
                    login
                    avatarUrl
                    url
                  }
                  name
                  email
                }
              }
            }
          }
        }
      }
    }
  }
`;

type FetchOutcome =
  | {
      kind: "ok";
      commits: CommitNode[];
      pages: number;
      truncated: boolean;
    }
  | {
      kind: "deadline";
      pages: number;
      partial: CommitNode[];
    }
  | {
      kind: "error";
      message: string;
      status: number | null;
      pages: number;
      rawBody?: string;
    };

async function fetchCommitHistory(
  octokit: Octokit,
  owner: string,
  name: string,
  sinceISO: string,
  untilISO: string,
  deadlineMs: number
): Promise<FetchOutcome> {
  const all: CommitNode[] = [];
  let cursor: string | null = null;
  let pages = 0;
  while (pages < MAX_PAGES_PER_REPO) {
    if (Date.now() >= deadlineMs) {
      return { kind: "deadline", pages, partial: all };
    }
    try {
      const data = (await octokit.graphql(COMMIT_HISTORY_QUERY, {
        owner,
        name,
        since: sinceISO,
        until: untilISO,
        cursor,
      })) as GraphQLResponse;
      pages += 1;
      const history = data.repository?.defaultBranchRef?.target?.history;
      if (!history) {
        // Empty repo, no default branch, or non-Commit target.
        return { kind: "ok", commits: all, pages, truncated: false };
      }
      all.push(...history.nodes);
      if (!history.pageInfo.hasNextPage) {
        return { kind: "ok", commits: all, pages, truncated: false };
      }
      cursor = history.pageInfo.endCursor;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? null;
      const message = err instanceof Error ? err.message : "GraphQL error";
      const rawBody = (() => {
        const responseData = (err as { response?: { data?: unknown } }).response?.data;
        if (responseData === undefined) return undefined;
        if (typeof responseData === "string") return responseData.slice(0, 1000);
        return JSON.stringify(responseData).slice(0, 1000);
      })();
      return { kind: "error", message, status, pages, rawBody };
    }
  }
  return { kind: "ok", commits: all, pages, truncated: true };
}

function buildWarning(
  repoFullName: string,
  outcome: Exclude<FetchOutcome, { kind: "ok" }>
): Warning {
  if (outcome.kind === "deadline") {
    return {
      repo: repoFullName,
      reason: `Per-repo deadline reached after ${outcome.pages} GraphQL page(s)`,
      message: `Got ${outcome.partial.length} commits before time ran out. Hit Retry — successful repos will be served from cache so this one gets the full budget.`,
      attempts: outcome.pages,
      lastStatus: 200,
    };
  }
  return {
    repo: repoFullName,
    reason: `GraphQL request failed (HTTP ${outcome.status ?? "?"})`,
    message: outcome.message,
    attempts: outcome.pages || 1,
    lastStatus: outcome.status,
    rawBody: outcome.rawBody,
  };
}

function aggregateCommits(commits: CommitNode[]): Racer[] {
  const byKey = new Map<string, Racer>();
  for (const c of commits) {
    const author = c.author;
    if (!author) continue;
    let key: string;
    let login: string;
    let avatarUrl: string;
    let htmlUrl: string;
    if (author.user) {
      key = author.user.login;
      login = author.user.login;
      avatarUrl = author.user.avatarUrl;
      htmlUrl = author.user.url;
    } else if (author.email || author.name) {
      const email = author.email ?? "";
      const name = author.name ?? "anonymous";
      key = email ? `email:${email}` : `name:${name}`;
      login = name;
      avatarUrl = "";
      htmlUrl = "#";
    } else {
      continue;
    }
    let racer = byKey.get(key);
    if (!racer) {
      racer = { login, avatarUrl, htmlUrl, additions: 0, deletions: 0, commits: 0 };
      byKey.set(key, racer);
    }
    racer.additions += c.additions;
    racer.deletions += c.deletions;
    racer.commits += 1;
  }
  return Array.from(byKey.values())
    .filter((r) => r.commits > 0)
    .sort((a, b) => b.additions - a.additions);
}

class RepoFetchFailure extends Error {
  outcome: Exclude<FetchOutcome, { kind: "ok" }>;
  fullName: string;
  constructor(fullName: string, outcome: Exclude<FetchOutcome, { kind: "ok" }>) {
    super(`Repo fetch failed: ${fullName}`);
    this.outcome = outcome;
    this.fullName = fullName;
    this.name = "RepoFetchFailure";
  }
}

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
  const deadlineMs = Date.now() + PER_REPO_DEADLINE_MS;
  const outcome = await fetchCommitHistory(octokit, org, repoName, sinceISO, untilISO, deadlineMs);
  if (outcome.kind !== "ok") {
    throw new RepoFetchFailure(`${org}/${repoName}`, outcome);
  }
  const racers = aggregateCommits(outcome.commits);
  const totalAdditions = racers.reduce((s, r) => s + r.additions, 0);
  const totalDeletions = racers.reduce((s, r) => s + r.deletions, 0);
  const totalCommits = racers.reduce((s, r) => s + r.commits, 0);
  if (totalCommits === 0) return null;
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

const cachedFetchRepoRace = unstable_cache(
  fetchRepoRaceUncached,
  ["repo-race-graphql-v1"],
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

  await withConcurrency(candidates, MAIN_CONCURRENCY, async (repo) => {
    if (Date.now() + PER_REPO_DEADLINE_MS > orgDeadlineMs) {
      warnings.push({
        repo: repo.full_name,
        reason: "Skipped — not enough time left in this request",
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
        warnings.push(buildWarning(err.fullName, err.outcome));
        return;
      }
      const outcome = (err as { outcome?: Exclude<FetchOutcome, { kind: "ok" }> }).outcome;
      const fullName = (err as { fullName?: string }).fullName ?? repo.full_name;
      if (outcome) {
        warnings.push(buildWarning(fullName, outcome));
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
  return getOrgRaceData({ org, since, until });
}
