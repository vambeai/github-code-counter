# 🏁 GitHub Code Race

Watch your GitHub **organization's** contributors race for monthly **lines-of-code** glory. A silly, satisfying way to celebrate (or roast) the people shipping the most code across all of your org's repos — public *and* private — with a per-repo breakdown.

> Lines of code is **not** a measure of productivity. Use this for fun, not performance reviews. 🙃

---

## ✨ Features

- 🏎️ Animated horizontal race with countdown, finish line, podium and sports-style commentary
- 🏢 Whole-organization mode: aggregates **every non-archived repo** in the org for a given month
- 🔓 Public **and** 🔒 private repo support (you bring the token)
- 📊 Per-repo breakdown — click any repo to see its own race
- 🥇 Full sortable scoreboard with avatars and links to GitHub profiles
- 🔐 `GITHUB_TOKEN` lives **only on the server** (Next.js Route Handler) — never shipped to the browser
- 🎯 Exact per-day precision (powered by GitHub's GraphQL API — no lazy-cache 202 hell)
- ⚡ Two-layer cache: 1h Vercel data cache per repo + edge cache (`s-maxage=3600`)
- 🚀 One-click deploy to Vercel

---

## 🧠 How it works

The Next.js Route Handler at [`src/app/api/race/route.ts`](src/app/api/race/route.ts):

1. Lists every repo in the org (`GET /orgs/{org}/repos?type=all`, paginated, cached 10 min).
2. Filters out archived repos and repos that haven't been pushed since the start of the selected month.
3. For each remaining repo, runs a **GraphQL query** against `repository.defaultBranchRef.target.history(since, until, first: 100)` and paginates until done. This returns commit-by-commit `additions`, `deletions`, `committedDate` and `author.user.login` — no lazy cache, no 202s, exact per-day precision. Calls run at concurrency 6.
4. Aggregates additions / deletions / commits per author over the selected month and produces one merged **org-wide leaderboard** plus a **per-repo breakdown**.
5. Each successful repo result is cached for 1h via [`unstable_cache`](https://nextjs.org/docs/app/api-reference/functions/unstable_cache), keyed on `org+repo+sinceISO+untilISO`. Repeat queries are essentially free.

Your `GITHUB_TOKEN` is read from `process.env` inside the Route Handler — **it never reaches the client**.

> 🧠 **Why GraphQL?** The REST `/stats/contributors` endpoint computes lazily and returns HTTP 202 on the first hit per repo, with no documented TTL. For org-wide scans this is unreliable ([GitHub Community discussion #190711](https://github.com/community/community/discussions/190711)). GraphQL queries are direct and predictable — typical cost per race is well under 5 GraphQL points (out of the 5,000/hour budget).

---

## 🚀 Quick start (local)

### 1. Clone & install

```bash
git clone https://github.com/<you>/github-code-race.git
cd github-code-race
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

Follow these steps **exactly** — `.env.local` is gitignored, so your token never gets committed.

1. **Copy the example file** at the project root:

   ```bash
   cp .env.example .env.local
   ```

2. **Open `.env.local`** in your editor. You should see one line:

   ```
   GITHUB_TOKEN=ghp_paste_your_token_here
   ```

3. **Replace the placeholder** with the token you copied in step 2 above. The line must look like this (no spaces, no quotes):

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
   curl "http://localhost:3000/api/race?org=vercel&month=$(date +%Y-%m)"
   ```

   - If you get JSON back → token is wired up. 🎉
   - If you get `"Server is missing the GITHUB_TOKEN environment variable."` → the file isn't being read. Re-check the filename (`.env.local`, not `.env.local.txt`), location (project root), and that you restarted the dev server.
   - If you get `"GitHub rejected the token..."` → the token is invalid, expired, or missing the right scopes / SSO authorization.

> 🔒 **Security:** the token is read inside the Next.js Route Handler (`src/app/api/race/route.ts`) and never serialized into any client bundle. You can confirm this by searching the built `.next/` output — `GITHUB_TOKEN` will not appear in any client chunk.

### 4. Run it

```bash
npm run dev
```

Open http://localhost:3000, type your org login (e.g. `vercel`), pick a month, hit **START THE RACE!**, and enjoy.

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
   | **Value** | paste the PAT from step 2 in *Quick start* (starts with `ghp_…` or `github_pat_…`) |
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
| `GITHUB_TOKEN` | yes | Used server-side to call the GitHub REST API. |

---

## 🛣 API reference

A single Route Handler:

```
GET /api/race?org=<org>&month=YYYY-MM
```

Response:

```jsonc
{
  "org": "vercel",
  "since": "2026-05-01T00:00:00.000Z",
  "until": "2026-06-01T00:00:00.000Z",
  "totalAdditions": 123456,
  "totalDeletions": 67890,
  "totalCommits": 1234,
  "racers": [
    {
      "login": "rauchg",
      "avatarUrl": "https://avatars.githubusercontent.com/u/...",
      "htmlUrl": "https://github.com/rauchg",
      "additions": 4321,
      "deletions": 1234,
      "commits": 42
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
      "racers": [/* per-repo racers */]
    }
  ],
  "warnings": [],
  "generatedAt": "2026-05-05T12:00:00.000Z"
}
```

Responses include `Cache-Control: public, s-maxage=3600, stale-while-revalidate=3600` plus debug headers `X-Cache-Generated-At` and `X-Cache-Age-Seconds` so you can tell if you're seeing fresh or cached data.

---

## 🧪 Notes & limitations

- **Default branch only.** GraphQL `defaultBranchRef.history` only walks commits on the repo's default branch. Side-branch work counts only after it's merged. (For "lines shipped this month" that's the correct semantic anyway.)
- **Force-push amnesia.** If someone rebases or squashes the default branch, commits removed from history will not be counted (true of any commit-based tool).
- **Bot accounts** (Dependabot, Renovate, GitHub Actions) will appear if they pushed commits — they often win, sorry.
- **Rate limits.** Authenticated GraphQL gives you 5,000 *points* per hour. Most queries cost ~1 point regardless of how many repos/commits — the app stays well under budget.
- **Per-repo cap.** The fetcher paginates up to 20 pages of 100 commits = 2,000 commits per repo per month. Anything beyond that is dropped with a warning. For ordinary org repos this is plenty; bump `MAX_PAGES_PER_REPO` if you have a Linux-sized monorepo.
- **Empty repos** (no commits in the selected month) are silently skipped.
- **Function timeouts.** A per-repo deadline (12s) and an org-level deadline (50s) protect against Vercel's `maxDuration` ceiling. Repos that don't fit get a warning and the **Retry skipped repos** button re-fetches just those (successful repos come from the 1h cache).

---

## 🧱 Tech stack

- [Next.js 15](https://nextjs.org/) (App Router, Route Handlers)
- [React 19](https://react.dev/)
- [TypeScript 5](https://www.typescriptlang.org/)
- [Tailwind CSS 3](https://tailwindcss.com/)
- [Framer Motion 11](https://www.framer.com/motion/)
- [@octokit/rest](https://github.com/octokit/rest.js)

---

## 🧑‍💻 Contributing

PRs welcome! Some ideas:

- 📅 Year-long mode and custom date ranges
- 🌐 Embed mode (`/embed/<org>`)
- 🗣 Multi-org leaderboards
- 🏁 Custom vehicles per primary language
- 🎨 Light theme

---

## 📄 License

MIT — see [LICENSE](LICENSE).
