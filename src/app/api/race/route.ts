import { NextRequest, NextResponse } from "next/server";
import { getCachedOrgRaceData } from "@/lib/github";

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

// ISO 8601 week parsing: "2026-W19" -> Monday of week 19 of 2026.
function isoWeekMonday(year: number, week: number): Date {
  // Per ISO 8601: Jan 4 is always in week 1; weeks start Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Sun=0 -> 7
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Mon);
  target.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return target;
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
  const weekParam = url.searchParams.get("week");

  const org = parseOrg(orgInput);
  if (!org) {
    return NextResponse.json(
      { error: "Invalid organization. Use a GitHub org login like 'vercel'." },
      { status: 400 }
    );
  }

  let since: Date;
  let until: Date;

  if (weekParam) {
    const m = weekParam.match(/^(\d{4})-W(\d{2})$/);
    if (!m) {
      return NextResponse.json(
        { error: "Invalid week. Use ISO 8601 format YYYY-Www (e.g. 2026-W19)." },
        { status: 400 }
      );
    }
    const year = parseInt(m[1], 10);
    const week = parseInt(m[2], 10);
    if (week < 1 || week > 53) {
      return NextResponse.json({ error: "Week number must be 1-53." }, { status: 400 });
    }
    since = isoWeekMonday(year, week);
    until = new Date(since.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else {
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
    since = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    until = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
  }

  try {
    const data = await getCachedOrgRaceData(org, since, until);
    const ageSeconds = Math.max(
      0,
      Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 1000)
    );
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
        "X-Cache-Generated-At": data.generatedAt,
        "X-Cache-Age-Seconds": String(ageSeconds),
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
