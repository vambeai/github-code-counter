# 🏁 GitHub Code Race

Watch your GitHub **organization's** contributors race for **lines-of-code** glory, week by week. A silly, satisfying way to celebrate (or roast) the people shipping the most code across all of your org's repos — public *and* private — with a per-repo breakdown and a per-author commit drilldown.

> Lines of code is **not** a measure of productivity. Use this for fun, not performance reviews. 🙃

---

## ✨ Features

- 🏎️ Animated horizontal race with countdown, finish line, podium and sports-style commentary
- 📅 **Week-scoped**: pick This week / Last week / 2 weeks ago / 3 weeks ago — one click, no calendar
- 🏢 Whole-organization mode: aggregates **every non-archived repo** with activity in the period
- 🔓 Public **and** 🔒 private repo support (you bring the token)
- 📊 Per-repo breakdown — click any repo to see its own race
- 🥇 Full sortable scoreboard with avatars and links to GitHub profiles
- 🔍 **Per-contributor commit drilldown** — click any racer to expand a sortable table of every commit they shipped, each linkable to GitHub for review
- 🤖 **Co-author crediting** — `Co-Authored-By:` trailers (PR review suggestions, Claude Code, pair programming) credit each contributor with full credit, not just the primary author
- 🧹 **Bloat filter** — any single file with >10,000 additions/deletions in a commit is excluded (lockfiles, generated clients, vendored deps, snapshots) so the leaderboard reflects real work
- 🔀 **Merge-commit aware** — commits with multiple parents are skipped so the merger doesn't double-count what the actual coders shipped
- 🎯 Exact per-day precision — powered by GitHub's GraphQL `Commit.history` API (no lazy-cache 202 hell)
- 🔐 `GITHUB_TOKEN` lives **only on the server** (Next.js Route Handler) — never shipped to the browser
- ⚡ Two-layer cache: 1h Next.js Data Cache per repo + edge cache (`s-maxage=3600`)
- 🚀 One-click deploy to Vercel

---

## 🧠 How it works

The Next.js Route Handler at [`src/app/api/race/route.ts`](src/app/api/race/route.ts):

1. **Lists every repo in the org** (`GET /orgs/{org}/repos?type=all`, paginated, cached 10 min).
2. **Filters candidates** — drops archived repos and repos that haven't been pushed since the start of the requested period.
3. **Fans out per-repo fetches** at concurrency 8. For each repo:
   - Splits the requested date range into **2-day windows** (a 7-day week → 4 windows).
   - Runs each window's GraphQL query in parallel via `Promise.all`. Each window paginates `repository.defaultBranchRef.target.history(since, until, first: 100)` until done.
   - Merges window results, dedupes by `oid`. Wall clock per repo ≈ `max(window pagination)`, not `sum`.
4. **Per-commit adjustment**: any commit whose total additions or deletions exceed 10,000 triggers a one-shot REST `GET /repos/{owner}/{repo}/commits/{ref}` call to fetch the per-file diff. Files with >10,000 line changes (lockfiles, generated code, vendored deps) are dropped from the totals; the rest of the commit's files still count.
5. **Aggregation**:
   - **Skips merge commits** (`parents.totalCount > 1`) so the merger doesn't get double-credited for the work in the merged branch.
   - For each remaining commit, identifies all contributors: the primary `author.user.login` plus every `Co-Authored-By: name <email>` trailer in the message body. Co-author logins are resolved from GitHub's noreply pattern (`12345+username@users.noreply.github.com`) or from a per-repo email→user map built from primary authors.
   - Each contributor receives the **full** additions/deletions/commits credit for that commit, and the commit appears in their `commitList` for the drilldown.
6. **Caches the result** for 1h via [`unstable_cache`](https://nextjs.org/docs/app/api-reference/functions/unstable_cache), keyed on `org+repo+sinceISO+untilISO`. Successful repo results are cached; errors are not, so failed repos retry on the next call while successful ones stay cheap.
7. **Org-level totals** sum each repo's real (unique-commit) totals — never the sum of racer counts, since co-author crediting can have one commit credited to multiple racers.

Your `GITHUB_TOKEN` is read from `process.env` inside the Route Handler — **it never reaches the client**.

> 🧠 **Why GraphQL instead of `/stats/contributors`?** The REST contributor-stats endpoint computes lazily and returns HTTP 202 on the first hit per repo, with no documented TTL ([GitHub Community discussion #190711](https://github.com/community/community/discussions/190711)). Concurrent requests overwhelm GitHub's background-job queue and persistent 202s become common. GraphQL queries are direct and predictable — typical cost per race is well under 5 GraphQL points (out of the 5,000/hour budget).

---

## 🚀 Quick start (local)

### 1. Clone & install

```bash
git clone https://github.com/<you>/github-code-counter.git
cd github-code-counter
npm install
```

### 2. Create a GitHub Personal Access Token

You need a token that can:

- Read the org's repos (including private ones, if any)
- Read commit data for those repos

#### Option A — Fine-grained PAT (recommended)

1. Go to https://github.com/settings/personal-access-tokens/new
2. **Resource owner** → choose your organization
3. **Repository access** → *All repositories* (or pick the ones you want)
4. **Repository permissions** → set **Contents: Read** and **Metadata: Read**
5. Generate, copy the token

> ℹ️ If your org enforces SAML SSO, click **Configure SSO** on the token after creating it and authorize it for the org.

#### Option B — Classic PAT

1. https://github.com/settings/tokens → **Generate new token (classic)**
2. Scopes: **`repo`** (covers private repos) and **`read:org`**
3. Copy the token, and authorize it for SAML SSO if your org requires it

### 3. Add the `GITHUB_TOKEN` to your local environment

`.env.local` is gitignored, so your token never gets committed.

1. **Copy the example file** at the project root:

   ```bash
   cp .env.example .env.local
   ```

2. **Open `.env.local`** in your editor. You should see one line:

   ```
   GITHUB_TOKEN=ghp_paste_your_token_here
   ```

3. **Replace the placeholder** with the token you copied. The line must look like this (no spaces, no quotes):

   ```
   GITHUB_TOKEN=ghp_abc123YourActualTokenValue456xyz
   ```

   - ✅ No spaces around `=`
   - ✅ No quotes around the value
   - ✅ One token per line
   - ❌ Do **not** prefix with `export`
   - ❌ Do **not** commit this file (already in `.gitignore`)

4. **Save the file** and **fully restart `npm run dev`** if it was already running — Next.js only reads `.env.local` on startup.

5. **Verify it loaded.** Hit the API directly:

   ```bash
   # Current week (Mon–Sun)
   curl "http://localhost:3000/api/race?org=vercel"
   ```

   - JSON back → token is wired up. 🎉
   - `"Server is missing the GITHUB_TOKEN environment variable."` → re-check the filename (`.env.local`, not `.env.local.txt`), location (project root), and that you restarted the dev server.
   - `"GitHub rejected the token..."` → the token is invalid, expired, or missing the right scopes / SSO authorization.

> 🔒 **Security:** the token is read inside the Route Handler and never serialized into any client bundle. You can confirm this by searching the built `.next/` output — `GITHUB_TOKEN` will not appear in any client chunk.

### 4. Run it

```bash
npm run dev
```

Open http://localhost:3000, type your org login (e.g. `vercel`), pick a week, hit **START THE RACE!**, and enjoy.

---

## ☁️ Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/perezpefaur/github-code-counter&env=GITHUB_TOKEN&envDescription=A%20GitHub%20PAT%20with%20read%20access%20to%20your%20org%27s%20repos)

### Step-by-step: add `GITHUB_TOKEN` on Vercel

1. **Push this repo to GitHub** (if you haven't yet):

   ```bash
   git push -u origin main
   ```

2. **Import the project** at [vercel.com/new](https://vercel.com/new) and select the repo. Don't deploy yet — Vercel will prompt you for environment variables on the import screen.

3. **Add the env var on the import screen** (or later under *Project → Settings → Environment Variables*):

   | Field | Value |
   | --- | --- |
   | **Key** | `GITHUB_TOKEN` |
   | **Value** | paste the PAT (starts with `ghp_…` or `github_pat_…`) |
   | **Environments** | ✅ Production ✅ Preview ✅ Development |

4. **Click *Deploy*.** Vercel injects the var into the serverless function at runtime.

5. **Verify on the deployed URL.** Open `https://<your-project>.vercel.app`, run a race for your org. If you see *"Server is missing the GITHUB_TOKEN..."*, jump back to *Settings → Environment Variables*, confirm the key name is exactly `GITHUB_TOKEN`, then **redeploy** (Vercel needs a redeploy after env-var changes — *Deployments → ⋯ → Redeploy*).

#### Rotating the token later

1. Generate a new PAT on GitHub.
2. Vercel → *Project → Settings → Environment Variables* → edit `GITHUB_TOKEN` → paste the new value → save.
3. Trigger a redeploy (push a commit, or *Deployments → ⋯ → Redeploy*).
4. Revoke the old token on GitHub.

> ⚠️ Always add the token via Vercel **Environment Variables** — never hard-code it or commit it to git. The API route runs server-side, so the token never reaches the browser.

The route handler sets `maxDuration = 60`, which is fine on Vercel's Hobby and Pro plans. For very large orgs, bump it up.

---

## ⚙️ Configuration

| Env var | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | yes | Used server-side to call the GitHub GraphQL + REST APIs. |

Tunables in [`src/lib/github.ts`](src/lib/github.ts) (top of file):

| Constant | Default | Purpose |
| --- | --- | --- |
| `PER_REPO_DEADLINE_MS` | `12_000` | Soft deadline per repo. Past it, partial data is kept (truncated). |
| `ORG_DEADLINE_MS` | `50_000` | Org-level soft deadline. Pre-dispatch check skips repos that wouldn't fit. |
| `MAIN_CONCURRENCY` | `8` | Number of repos fetched in parallel. |
| `MAX_PAGES_PER_REPO` | `10` | Pagination cap **per window**. With 2-day windows that's up to 1,000 commits per window. |
| `WINDOW_DAYS` | `2` | Slice size for the parallel windowing fan-out. |
| `FILE_LINE_THRESHOLD` | `10_000` | Files exceeding this in a single commit are excluded (lockfiles, generated, etc.). |
| `MAX_COMMITS_PER_AUTHOR` | `200` | Cap on the per-author commitList shipped to the client. |

---

## 🛣 API reference

```
GET /api/race?org=<org>&since=YYYY-MM-DD&until=YYYY-MM-DD
```

- `since` / `until` are inclusive day stamps (the days the user sees in the picker). The server expands `until` by one day internally for an exclusive-end model.
- Legacy `?month=YYYY-MM` and `?week=YYYY-Www` (ISO 8601) are still accepted for backwards compatibility.
- Without a date param, defaults to the current ISO week (Mon–Sun).

Response:

```jsonc
{
  "org": "vercel",
  "since": "2026-05-04T00:00:00.000Z",
  "until": "2026-05-11T00:00:00.000Z",
  "totalAdditions": 12345,
  "totalDeletions": 6789,
  "totalCommits": 234,
  "racers": [
    {
      "login": "rauchg",
      "avatarUrl": "https://avatars.githubusercontent.com/u/...",
      "htmlUrl": "https://github.com/rauchg",
      "additions": 4321,
      "deletions": 1234,
      "commits": 42,
      "commitList": [
        {
          "sha": "abc1234567...",
          "repo": "vercel/next.js",
          "message": "feat(router): pre-render route shell on hover",
          "additions": 200,
          "deletions": 30,
          "committedDate": "2026-05-05T13:42:00.000Z",
          "htmlUrl": "https://github.com/vercel/next.js/commit/abc1234...",
          "excludedFiles": 0
        }
      ]
    }
  ],
  "repos": [
    {
      "name": "next.js",
      "fullName": "vercel/next.js",
      "htmlUrl": "https://github.com/vercel/next.js",
      "private": false,
      "totalAdditions": 1000,
      "totalDeletions": 500,
      "totalCommits": 100,
      "racers": [/* per-repo racers, same shape minus commitList */],
      "truncated": false
    }
  ],
  "warnings": [
    {
      "repo": "vercel/heavy-monorepo",
      "reason": "Partial data — repo had more commits than fit in this request",
      "message": "Per-repo deadline (12s) reached after 4 GraphQL page(s)...",
      "attempts": 0,
      "lastStatus": 200
    }
  ],
  "generatedAt": "2026-05-05T12:00:00.000Z"
}
```

Response headers:

| Header | Meaning |
| --- | --- |
| `Cache-Control: public, s-maxage=3600, stale-while-revalidate=3600` | 1h edge cache. |
| `X-Cache-Generated-At` | ISO timestamp of the cached function's run time. |
| `X-Cache-Age-Seconds` | How old the response is, in seconds. |

The UI shows a small badge ("fresh" / "cached 4m ago") next to the org subtitle so you can tell at a glance.

---

## 🧪 Notes & limitations

- **Default branch only.** Walks `defaultBranchRef.history`. Side-branch work counts only after it's merged. (For "lines shipped this period" that's the correct semantic anyway.)
- **Merge commits are excluded.** Commits with `parents.totalCount > 1` don't contribute additions — their content is already credited to the individual commits on the merged branch. This means whoever clicks "Merge pull request #X" doesn't get free credit. Conflict-resolution lines hidden inside merge commits are a small accepted undercount, matching `git-fame` / `cloc` defaults.
- **Co-author crediting.** Each `Co-Authored-By:` trailer credits the listed contributor with the same additions/deletions as the primary author. Logins are resolved via GitHub's noreply pattern or via emails seen on primary commits in the same repo.
- **>10k-line files are filtered.** Anything in a single commit where additions OR deletions exceed 10,000 in one file is dropped. Catches most lockfile/generated bloat. Tweak `FILE_LINE_THRESHOLD` to taste.
- **Force-push amnesia.** If someone rebases or squashes the default branch, commits removed from history will not be counted (true of any commit-based tool).
- **Bot accounts** (Dependabot, Renovate, GitHub Actions, Claude Code's `claude[bot]`) appear in the scoreboard if they pushed or co-authored commits.
- **Rate limits.** Authenticated GraphQL gives you 5,000 *points* per hour. The app stays well under budget — typical week-scoped race is a handful of points.
- **Per-repo cap.** With `WINDOW_DAYS=2` and `MAX_PAGES_PER_REPO=10`, each window holds up to 1,000 commits. A 7-day week → 4 windows = 4,000 commits per repo per week ceiling. For ordinary org repos this is plenty; tune `WINDOW_DAYS` smaller if a single repo is more active than that.
- **Empty repos** (no commits in the period) are silently skipped.
- **Function timeouts.** Per-repo (12s) and org-level (50s) soft deadlines protect against Vercel's `maxDuration`. Repos that don't fit get a `truncated` badge or warning, and the **Retry skipped repos** button re-fetches just those (successful repos stay cached).

---

## 🧱 Tech stack

- [Next.js 15](https://nextjs.org/) (App Router, Route Handlers, `unstable_cache`)
- [React 19](https://react.dev/)
- [TypeScript 5](https://www.typescriptlang.org/)
- [Tailwind CSS 3](https://tailwindcss.com/) + `tailwindcss-animate`
- [Framer Motion 11](https://www.framer.com/motion/)
- [@octokit/rest](https://github.com/octokit/rest.js) (REST + GraphQL via `octokit.graphql`)
- [date-fns 4](https://date-fns.org/) for week math
- [lucide-react](https://lucide.dev/) for icons
- [clsx](https://github.com/lukeed/clsx) + [tailwind-merge](https://github.com/dcastil/tailwind-merge) (`cn` helper)

---

## 🗂 Project layout

```
src/
├── app/
│   ├── api/race/route.ts     # the only server endpoint
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx              # client home — form + race + scoreboard + drilldown
├── components/
│   ├── Commentary.tsx        # rolling smack-talk
│   ├── OrgForm.tsx           # org input + 4 week buttons
│   ├── RaceTrack.tsx         # animated lanes / podium / countdown
│   ├── RepoBreakdown.tsx     # per-repo cards with mini-races
│   ├── Scoreboard.tsx        # full table + per-author commit drilldown
│   └── Warnings.tsx          # raw GitHub response inspector
└── lib/
    ├── github.ts             # GraphQL fetch, windowing, aggregation, caching
    ├── storage.ts            # localStorage helpers (saved org)
    ├── types.ts              # shared TS types
    └── utils.ts              # cn() helper
```

---

## 🧑‍💻 Contributing

PRs welcome! Some ideas:

- 🧩 Configurable bot-filter (toggle `dependabot`, `renovate`, `claude[bot]`, etc.)
- 🌐 Embed mode (`/embed/<org>`)
- 🗣 Multi-org leaderboards
- 🏁 Custom vehicles per primary language
- 🎨 Light theme
- 🗓 Custom date range picker (re-introduce the calendar UI as an "Advanced" option)
- 📅 Year-long aggregations / historical comparisons

---

## 📄 License

MIT — see [LICENSE](LICENSE).
