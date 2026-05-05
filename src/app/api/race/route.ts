import { NextRequest, NextResponse, after } from "next/server";
import { getCachedOrgRaceData, warmFailedRepos } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function parseOrg(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  const urlMatch = value.match(/^https?:\/\/github\.com\/([^/?#]+)/i);
  if (urlMatch) value = urlMatch[1];
  value = value.split("/")[0];
  if (!ORG_PATTERN.test(value)) return null;
  return value;
}

export async function GET(req: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Server is missing the GITHUB_TOKEN environment variable." },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const orgInput = url.searchParams.get("org") ?? "";
  const monthParam = url.searchParams.get("month");

  const org = parseOrg(orgInput);
  if (!org) {
    return NextResponse.json(
      { error: "Invalid organization. Use a GitHub org login like 'vercel'." },
      { status: 400 }
    );
  }

  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  if (monthParam) {
    const m = monthParam.match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      return NextResponse.json({ error: "Invalid month. Use YYYY-MM." }, { status: 400 });
    }
    year = parseInt(m[1], 10);
    month = parseInt(m[2], 10) - 1;
  }
  const since = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const until = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));

  try {
    const startedAt = Date.now();
    const data = await getCachedOrgRaceData(org, since, until);
    const elapsedMs = Date.now() - startedAt;

    // Repos that came back as HTTP 202 ("still computing"): we kicked off the
    // background job on GitHub's side; now we keep poking them in the after()
    // hook so GitHub finishes computing and the next user-driven race finds
    // them cached. We use whatever serverless budget is left.
    const stillComputing = data.warnings
      .filter((w) => w.lastStatus === 202 && w.repo.startsWith(`${org}/`))
      .map((w) => w.repo.slice(org.length + 1));

    if (stillComputing.length > 0) {
      // Leave a 5s safety margin under maxDuration so Vercel doesn't kill the
      // function while after() is mid-poke.
      const remainingBudgetMs = Math.max(0, 60_000 - elapsedMs - 5_000);
      if (remainingBudgetMs > 4_000) {
        after(async () => {
          try {
            await warmFailedRepos(org, stillComputing, remainingBudgetMs);
          } catch {
            // best effort
          }
        });
      }
    }

    const ageSeconds = Math.max(
      0,
      Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 1000)
    );
    return NextResponse.json(data, {
      headers: {
        // Edge cache for 1h. Per-repo data lives in Next.js' data cache, also 1h.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
        "X-Cache-Generated-At": data.generatedAt,
        "X-Cache-Age-Seconds": String(ageSeconds),
        "X-Warming-Repos": String(stillComputing.length),
      },
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : "Unknown error";
    if (status === 404) {
      return NextResponse.json(
        { error: `Organization '${org}' not found, or your token can't see it.` },
        { status: 404 }
      );
    }
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: "GitHub rejected the token. Check scopes / SSO authorization." },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
