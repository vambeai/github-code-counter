"use client";

import { useCallback, useEffect, useState } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import OrgForm from "@/components/OrgForm";
import RaceTrack from "@/components/RaceTrack";
import RepoBreakdown from "@/components/RepoBreakdown";
import Scoreboard from "@/components/Scoreboard";
import Warnings from "@/components/Warnings";
import { loadSavedOrg } from "@/lib/storage";
import type { DateRangeValue, RaceData } from "@/lib/types";

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

function formatRange(sinceISO: string, untilISO: string): string {
  const s = new Date(sinceISO);
  const u = new Date(untilISO);
  const isMonth =
    s.getUTCDate() === 1 &&
    u.getUTCDate() === 1 &&
    ((s.getUTCMonth() + 1) % 12 === u.getUTCMonth() ||
      (s.getUTCMonth() === 11 && u.getUTCMonth() === 0));
  if (isMonth) {
    return s.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const lastDay = new Date(u.getTime() - 24 * 60 * 60 * 1000);
  const startStr = s.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endStr = lastDay.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: lastDay.getUTCFullYear() !== s.getUTCFullYear() ? "numeric" : undefined,
    timeZone: "UTC",
  });
  return `${startStr} — ${endStr}`;
}

function rangeToParams(range: DateRangeValue): URLSearchParams {
  const params = new URLSearchParams();
  params.set("since", format(range.from, "yyyy-MM-dd"));
  params.set("until", format(range.to, "yyyy-MM-dd"));
  return params;
}

export default function Home() {
  const [data, setData] = useState<RaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOrg, setSavedOrg] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<{ org: string; range: DateRangeValue } | null>(null);

  const startRace = useCallback(
    async (org: string, range: DateRangeValue, mode: "full" | "retry" = "full") => {
      if (mode === "retry") {
        setRetrying(true);
      } else {
        setLoading(true);
        setData(null);
      }
      setError(null);
      setLastQuery({ org, range });
      try {
        const params = rangeToParams(range);
        params.set("org", org);
        const res = await fetch(`/api/race?${params.toString()}`);
        const text = await res.text();
        let json: RaceData | { error?: string } | null = null;
        try {
          json = text ? (JSON.parse(text) as RaceData | { error?: string }) : null;
        } catch {
          // Non-JSON body — usually a Vercel platform error (timeout, gateway).
        }
        if (!res.ok) {
          const fromJson = json && "error" in json ? json.error : undefined;
          const snippet = text ? text.slice(0, 180) : `HTTP ${res.status}`;
          throw new Error(fromJson || snippet);
        }
        if (!json) {
          throw new Error(
            `The server returned a non-JSON response (${res.status}) — likely a Vercel function timeout. Hit START again; repos that just finished computing on GitHub will be cached now.`
          );
        }
        setData(json as RaceData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
        setRetrying(false);
      }
    },
    []
  );

  const retrySkippedRepos = useCallback(() => {
    if (!lastQuery) return;
    void startRace(lastQuery.org, lastQuery.range, "retry");
  }, [lastQuery, startRace]);

  // On first mount: hydrate the saved org from localStorage and auto-start
  // the race for the current week (Mon-Sun).
  useEffect(() => {
    const org = loadSavedOrg();
    if (!org) return;
    setSavedOrg(org);
    const now = new Date();
    const range: DateRangeValue = {
      from: startOfWeek(now, { weekStartsOn: 1 }),
      to: endOfWeek(now, { weekStartsOn: 1 }),
    };
    void startRace(org, range);
  }, [startRace]);

  const periodLabel = data ? formatRange(data.since, data.until) : "";

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <header className="text-center mb-8">
        <h1 className="race-title text-4xl md:text-6xl text-yellow-300 drop-shadow-[0_0_25px_rgba(253,224,71,0.4)]">
          🏁 GITHUB CODE RACE 🏁
        </h1>
        <p className="mt-3 text-zinc-300 text-base md:text-lg">
          Who shipped the most lines this week? Place your bets, devs.
        </p>
      </header>

      <OrgForm onStart={startRace} loading={loading} initialOrg={savedOrg} />

      {error && (
        <div className="mt-6 rounded-lg border border-red-500 bg-red-950/40 p-4 text-red-200">
          <strong className="race-title text-red-300">YELLOW FLAG: </strong>
          {error}
        </div>
      )}

      {loading && <LoadingScreen />}

      {data && (
        <>
          <RaceTrack
            title={`${data.org}/*  ·  ${periodLabel}`}
            subtitle={
              <>
                <span className="text-emerald-400">+{fmtNum(data.totalAdditions)}</span>{"  "}
                <span className="text-rose-400">-{fmtNum(data.totalDeletions)}</span>
                {"  ·  "}
                {fmtNum(data.totalCommits)} commits across {data.repos.length} repos
                {"  ·  "}
                <CacheBadge generatedAt={data.generatedAt} />
              </>
            }
            racers={data.racers}
            resetKey={data.generatedAt}
          />
          <Scoreboard racers={data.racers} />
          <RepoBreakdown repos={data.repos} since={data.since} />
          <Warnings
            warnings={data.warnings}
            onRetry={retrySkippedRepos}
            retrying={retrying}
          />
        </>
      )}

      <footer className="mt-16 text-center text-zinc-500 text-sm">
        <p>
          Powered by the GitHub Stats API. Token stays server-side.{" "}
          <a
            className="underline hover:text-yellow-300"
            href="https://github.com/perezpefaur/github-code-counter"
          >
            Open source
          </a>
          .
        </p>
      </footer>
    </main>
  );
}

function LoadingScreen() {
  return (
    <div className="mt-12 text-center">
      <div className="text-6xl flag">🏁</div>
      <p className="mt-4 race-title text-yellow-300 text-xl">REVVING ENGINES...</p>
      <p className="text-zinc-400 mt-2">
        Listing org repos and crunching contributor stats. GitHub may take a few seconds the first
        time it builds the cache for a repo.
      </p>
    </div>
  );
}

function CacheBadge({ generatedAt }: { generatedAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const ageSec = Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000));
  const fresh = ageSec < 60;
  let label: string;
  if (fresh) label = "fresh";
  else if (ageSec < 3600) label = `cached ${Math.floor(ageSec / 60)}m ago`;
  else label = `cached ${Math.floor(ageSec / 3600)}h ago`;
  return (
    <span
      title={`Generated at ${new Date(generatedAt).toLocaleString()}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
        fresh
          ? "border-emerald-500/40 text-emerald-300"
          : "border-zinc-700 text-zinc-400"
      }`}
    >
      <span className={fresh ? "text-emerald-400" : "text-zinc-500"}>●</span>
      {label}
    </span>
  );
}
