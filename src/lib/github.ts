import { Octokit } from "@octokit/rest";
import { unstable_cache } from "next/cache";
import type { CommitInfo, Racer, RaceData, RepoRace, Warning } from "./types";

// Budget tuning for Vercel's 60s maxDuration:
//  * Per-repo we slice the requested date range into 2-day windows fetched
//    in parallel via Promise.all (see fetchCommitHistoryWindowed). For a
//    typical 7-day week that's ~4 parallel queries; for the heaviest repos
//    each window carries 100-200 commits = 1-2 pages instead of 4-5.
//  * Result: per-repo wall clock drops to ~max(window_pagination), letting
//    a 12s budget comfortably handle even vambeai-backend-class repos.
//  * Concurrency 8, 21 repos in 3 rounds * ~10s + listing ~2s = ~32s. Org
//    deadline 50s leaves clean margin under the 60s maxDuration.
//  * Partial pagination data is preserved (truncated=true) instead of thrown
//    away if any single window's deadline still hits.
const PER_REPO_DEADLINE_MS = 12_000;
const ORG_DEADLINE_MS = 50_000;
const MAIN_CONCURRENCY = 8;
const MAX_PAGES_PER_REPO = 10;
const WINDOW_DAYS = 2;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
// Per-file (NOT per-commit) threshold. Any single file in a commit whose
// additions OR deletions exceed this is excluded — lockfiles, generated
// code, vendored deps, large data dumps, etc. The rest of the commit's
// files still count.
const FILE_LINE_THRESHOLD = 5_000;
const COMMIT_DETAIL_CONCURRENCY = 4;
// Cap the per-author commit list we ship to the client.
const MAX_COMMITS_PER_AUTHOR = 200;

type CommitNode = {
  oid: string;
  messageHeadline: string;
  message: string;
  url: string;
  additions: number;
  deletions: number;
  committedDate: string;
  parents: { totalCount: number };
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
                messageHeadline
                message
                url
                additions
                deletions
                committedDate
                parents {
                  totalCount
                }
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

function computeRangeWindows(
  since: Date,
  until: Date
): Array<{ since: Date; until: Date }> {
  const windows: Array<{ since: Date; until: Date }> = [];
  let cursorMs = since.getTime();
  const untilMs = until.getTime();
  while (cursorMs < untilMs) {
    const endMs = Math.min(cursorMs + WINDOW_MS, untilMs);
    windows.push({ since: new Date(cursorMs), until: new Date(endMs) });
    cursorMs = endMs;
  }
  if (windows.length === 0) windows.push({ since, until });
  return windows;
}

// Fan out per-repo fetches into parallel weekly windows. For a 30-day month
// that's ~5 weeks running in parallel via Promise.all; each window paginates
// independently. Merges and dedupes by commit oid. Even with one heavy repo,
// the wall clock is bounded by the busiest single week, not the whole month.
async function fetchCommitHistoryWindowed(
  octokit: Octokit,
  owner: string,
  name: string,
  sinceISO: string,
  untilISO: string,
  deadlineMs: number
): Promise<FetchOutcome> {
  const windows = computeRangeWindows(new Date(sinceISO), new Date(untilISO));
  if (windows.length <= 1) {
    return fetchCommitHistory(octokit, owner, name, sinceISO, untilISO, deadlineMs);
  }
  const results = await Promise.all(
    windows.map((w) =>
      fetchCommitHistory(
        octokit,
        owner,
        name,
        w.since.toISOString(),
        w.until.toISOString(),
        deadlineMs
      )
    )
  );

  let totalPages = 0;
  let anyTruncated = false;
  let firstError: Extract<FetchOutcome, { kind: "error" }> | null = null;
  const allCommits: CommitNode[] = [];

  for (const r of results) {
    totalPages += r.pages;
    if (r.kind === "ok") {
      allCommits.push(...r.commits);
      if (r.truncated) anyTruncated = true;
    } else if (r.kind === "deadline") {
      allCommits.push(...r.partial);
      anyTruncated = true;
    } else if (!firstError) {
      firstError = r;
    }
  }

  // If every window failed and we got nothing, propagate the error.
  if (allCommits.length === 0 && firstError) return firstError;

  // Defensive: dedupe by oid in case windows overlap on boundaries.
  const seen = new Set<string>();
  const unique = allCommits.filter((c) => {
    if (seen.has(c.oid)) return false;
    seen.add(c.oid);
    return true;
  });

  if (anyTruncated) {
    return { kind: "deadline", pages: totalPages, partial: unique };
  }
  return { kind: "ok", commits: unique, pages: totalPages, truncated: false };
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

type AdjustedCommit = {
  node: CommitNode;
  additions: number;
  deletions: number;
  excludedFiles: number;
};

async function fetchCommitFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<Array<{ filename: string; additions: number; deletions: number }> | null> {
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", {
      owner,
      repo,
      ref: sha,
    });
    const data = res.data as {
      files?: Array<{ filename: string; additions: number; deletions: number }>;
    };
    return data.files ?? null;
  } catch {
    return null;
  }
}

async function adjustCommit(
  octokit: Octokit,
  org: string,
  repoName: string,
  c: CommitNode
): Promise<AdjustedCommit> {
  // Fast path: if the commit's TOTAL additions/deletions are below the threshold,
  // no single file can exceed it either — accept the GraphQL totals as-is.
  if (c.additions <= FILE_LINE_THRESHOLD && c.deletions <= FILE_LINE_THRESHOLD) {
    return { node: c, additions: c.additions, deletions: c.deletions, excludedFiles: 0 };
  }
  const files = await fetchCommitFiles(octokit, org, repoName, c.oid);
  if (!files) {
    // REST detail unavailable (rate limit, error). Conservatively keep the totals.
    return { node: c, additions: c.additions, deletions: c.deletions, excludedFiles: 0 };
  }
  let additions = 0;
  let deletions = 0;
  let excluded = 0;
  for (const f of files) {
    const a = f.additions ?? 0;
    const d = f.deletions ?? 0;
    if (a > FILE_LINE_THRESHOLD || d > FILE_LINE_THRESHOLD) {
      excluded += 1;
      continue;
    }
    additions += a;
    deletions += d;
  }
  return { node: c, additions, deletions, excludedFiles: excluded };
}

type Contributor = {
  key: string;
  login: string;
  avatarUrl: string;
  htmlUrl: string;
};

// GitHub auto-generates noreply emails like "12345+username@users.noreply.github.com"
// for co-authoring suggestions in PR reviews. We can extract the login from these
// reliably. For other emails, we fall back to a per-repo email -> user map built
// from primary authors who DID have user.login resolved.
const NOREPLY_EMAIL_RE = /^\d+\+([\w.-]+)@users\.noreply\.github\.com$/i;
const COAUTHOR_TRAILER_RE = /^Co-Authored-By:\s*([^<]+?)\s*<\s*([^>]+?)\s*>\s*$/i;

function loginFromNoreplyEmail(email: string): string | null {
  const m = email.match(NOREPLY_EMAIL_RE);
  return m ? m[1] : null;
}

function parseCoAuthorsFromMessage(message: string): Array<{ name: string; email: string }> {
  if (!message) return [];
  const out: Array<{ name: string; email: string }> = [];
  for (const line of message.split(/\r?\n/)) {
    const m = line.match(COAUTHOR_TRAILER_RE);
    if (!m) continue;
    out.push({ name: m[1].trim(), email: m[2].trim() });
  }
  return out;
}

function buildEmailToUserMap(
  commits: AdjustedCommit[]
): Map<string, { login: string; avatarUrl: string; htmlUrl: string }> {
  const map = new Map<string, { login: string; avatarUrl: string; htmlUrl: string }>();
  for (const ac of commits) {
    const author = ac.node.author;
    if (!author?.user || !author.email) continue;
    if (!map.has(author.email)) {
      map.set(author.email, {
        login: author.user.login,
        avatarUrl: author.user.avatarUrl,
        htmlUrl: author.user.url,
      });
    }
  }
  return map;
}

function resolveContributors(
  c: CommitNode,
  emailToUser: Map<string, { login: string; avatarUrl: string; htmlUrl: string }>
): Contributor[] {
  const contributors: Contributor[] = [];
  const seen = new Set<string>();

  // Primary author.
  const author = c.author;
  if (author) {
    if (author.user) {
      const key = author.user.login;
      if (!seen.has(key)) {
        seen.add(key);
        contributors.push({
          key,
          login: author.user.login,
          avatarUrl: author.user.avatarUrl,
          htmlUrl: author.user.url,
        });
      }
    } else if (author.email || author.name) {
      const email = author.email ?? "";
      const name = author.name ?? "anonymous";
      const resolved = email ? emailToUser.get(email) : undefined;
      const key = resolved
        ? resolved.login
        : email
          ? `email:${email}`
          : `name:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        contributors.push(
          resolved
            ? { key: resolved.login, ...resolved }
            : { key, login: name, avatarUrl: "", htmlUrl: "#" }
        );
      }
    }
  }

  // Co-authors from trailers — full credit for each.
  for (const ca of parseCoAuthorsFromMessage(c.message)) {
    let resolvedLogin: string | null = null;
    let resolvedAvatar = "";
    let resolvedHtml = "#";

    // 1) noreply pattern (most reliable — used by GitHub PR suggestions).
    const noreplyLogin = loginFromNoreplyEmail(ca.email);
    if (noreplyLogin) {
      resolvedLogin = noreplyLogin;
      resolvedAvatar = `https://github.com/${noreplyLogin}.png?size=64`;
      resolvedHtml = `https://github.com/${noreplyLogin}`;
    }
    // 2) email -> user map built from primary authors in this repo.
    if (!resolvedLogin) {
      const found = emailToUser.get(ca.email);
      if (found) {
        resolvedLogin = found.login;
        resolvedAvatar = found.avatarUrl;
        resolvedHtml = found.htmlUrl;
      }
    }

    const key = resolvedLogin ? resolvedLogin : `email:${ca.email}`;
    if (seen.has(key)) continue; // dedupe (e.g. someone listed as both primary and co-author)
    seen.add(key);

    contributors.push(
      resolvedLogin
        ? { key, login: resolvedLogin, avatarUrl: resolvedAvatar, htmlUrl: resolvedHtml }
        : { key, login: ca.name, avatarUrl: "", htmlUrl: "#" }
    );
  }

  return contributors;
}

type AggregateResult = {
  racers: Racer[];
  realTotalAdditions: number;
  realTotalDeletions: number;
  realTotalCommits: number;
};

function aggregateAdjusted(
  commits: AdjustedCommit[],
  repoFullName: string
): AggregateResult {
  const byKey = new Map<string, Racer>();
  const emailToUser = buildEmailToUserMap(commits);
  let realTotalAdditions = 0;
  let realTotalDeletions = 0;
  let realTotalCommits = 0;

  for (const ac of commits) {
    const c = ac.node;
    // Skip merge commits. Their additions are the cumulative diff of the
    // merged branch and are already credited to the individual commits on
    // that branch (which are also in this history). Counting them would
    // double-count lines AND attribute them to whoever clicked "Merge"
    // instead of the people who actually wrote the code.
    if (c.parents && c.parents.totalCount > 1) continue;
    const contributors = resolveContributors(c, emailToUser);
    if (contributors.length === 0) continue;

    realTotalAdditions += ac.additions;
    realTotalDeletions += ac.deletions;
    realTotalCommits += 1;

    for (const contrib of contributors) {
      let racer = byKey.get(contrib.key);
      if (!racer) {
        racer = {
          login: contrib.login,
          avatarUrl: contrib.avatarUrl,
          htmlUrl: contrib.htmlUrl,
          additions: 0,
          deletions: 0,
          commits: 0,
          commitList: [],
        };
        byKey.set(contrib.key, racer);
      }
      racer.additions += ac.additions;
      racer.deletions += ac.deletions;
      racer.commits += 1;
      racer.commitList!.push({
        sha: c.oid,
        repo: repoFullName,
        message: c.messageHeadline?.slice(0, 200) ?? "",
        additions: ac.additions,
        deletions: ac.deletions,
        committedDate: c.committedDate,
        htmlUrl: c.url,
        excludedFiles: ac.excludedFiles || undefined,
      });
    }
  }

  return {
    racers: Array.from(byKey.values())
      .filter((r) => r.commits > 0)
      .sort((a, b) => b.additions - a.additions),
    realTotalAdditions,
    realTotalDeletions,
    realTotalCommits,
  };
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
  const outcome = await fetchCommitHistoryWindowed(
    octokit,
    org,
    repoName,
    sinceISO,
    untilISO,
    deadlineMs
  );
  const repoFullName = `${org}/${repoName}`;

  // Decide which commits we have to work with. On a hard error (auth, 404,
  // etc.) we still throw so the route surfaces the diagnostic. On a deadline
  // outcome we KEEP the partial commits collected so far and mark the repo
  // as truncated — losing the data we already paid for makes no sense.
  let commits: CommitNode[];
  let truncated = false;
  let truncationNote: string | undefined;
  if (outcome.kind === "ok") {
    commits = outcome.commits;
  } else if (outcome.kind === "deadline") {
    commits = outcome.partial;
    truncated = true;
    truncationNote = `Per-repo deadline (${PER_REPO_DEADLINE_MS / 1000}s) reached after ${outcome.pages} GraphQL page(s). Showing the ${outcome.partial.length} commits we collected (most recent first).`;
    if (commits.length === 0) {
      throw new RepoFetchFailure(repoFullName, outcome);
    }
  } else {
    throw new RepoFetchFailure(repoFullName, outcome);
  }

  // For each commit, decide whether we need to fetch the per-file diff (only
  // if total adds/dels could contain a file > FILE_LINE_THRESHOLD). REST calls
  // run with their own concurrency limiter so we don't blow the deadline.
  const adjusted = await withConcurrency(commits, COMMIT_DETAIL_CONCURRENCY, async (c) => {
    if (Date.now() >= deadlineMs) {
      return {
        node: c,
        additions: c.additions,
        deletions: c.deletions,
        excludedFiles: 0,
      } satisfies AdjustedCommit;
    }
    return adjustCommit(octokit, org, repoName, c);
  });
  const aggregate = aggregateAdjusted(adjusted, repoFullName);
  if (aggregate.realTotalCommits === 0) return null;
  return {
    name: repoName,
    fullName: repoFullName,
    htmlUrl,
    private: isPrivate,
    totalAdditions: aggregate.realTotalAdditions,
    totalDeletions: aggregate.realTotalDeletions,
    totalCommits: aggregate.realTotalCommits,
    racers: aggregate.racers,
    truncated: truncated || undefined,
    truncationNote,
  };
}

const cachedFetchRepoRace = unstable_cache(
  fetchRepoRaceUncached,
  ["repo-race-graphql-v7-no-merges"],
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
      if (result) {
        repoRaces.push(result);
        if (result.truncated) {
          warnings.push({
            repo: result.fullName,
            reason: "Partial data — repo had more commits than fit in this request",
            message:
              result.truncationNote ??
              "We collected commits up to the deadline; older commits in this month may be missing.",
            attempts: 0,
            lastStatus: 200,
          });
        }
      }
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
        if (r.commitList && r.commitList.length > 0) {
          if (!existing.commitList) existing.commitList = [];
          existing.commitList.push(...r.commitList);
        }
      } else {
        orgRacerMap.set(r.login, {
          ...r,
          commitList: r.commitList ? [...r.commitList] : undefined,
        });
      }
    }
  }
  // Sort each racer's commit list by additions desc and cap to MAX_COMMITS_PER_AUTHOR.
  for (const racer of orgRacerMap.values()) {
    if (!racer.commitList) continue;
    racer.commitList.sort((a, b) => b.additions - a.additions);
    if (racer.commitList.length > MAX_COMMITS_PER_AUTHOR) {
      racer.commitList = racer.commitList.slice(0, MAX_COMMITS_PER_AUTHOR);
    }
  }
  const orgRacers = Array.from(orgRacerMap.values()).sort((a, b) => b.additions - a.additions);
  // Real org totals = sum of each repo's real totals (NOT sum of racer counts —
  // co-authoring credits multiple racers for the same commit, which would
  // overcount lines/commits at the org level).
  const totalAdditions = repoRaces.reduce((s, r) => s + r.totalAdditions, 0);
  const totalDeletions = repoRaces.reduce((s, r) => s + r.totalDeletions, 0);
  const totalCommits = repoRaces.reduce((s, r) => s + r.totalCommits, 0);

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
