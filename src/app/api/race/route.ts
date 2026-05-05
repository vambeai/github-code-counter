import { NextRequest, NextResponse } from "next/server";
import { getOrgRaceData } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function parseOrg(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  // Allow pasting a github URL like https://github.com/vercel
  const urlMatch = value.match(/^https?:\/\/github\.com\/([^/?#]+)/i);
  if (urlMatch) value = urlMatch[1];
  // Strip trailing slash or path segments (e.g. "vercel/next.js")
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
    const data = await getOrgRaceData({ org, since, until, token });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
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
