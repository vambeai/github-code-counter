"use client";

import { useState } from "react";
import OrgForm from "@/components/OrgForm";
import RaceTrack from "@/components/RaceTrack";
import RepoBreakdown from "@/components/RepoBreakdown";
import Scoreboard from "@/components/Scoreboard";
import type { RaceData } from "@/lib/types";

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

export default function Home() {
  const [data, setData] = useState<RaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startRace(org: string, month: string) {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({ org });
      if (month) params.set("month", month);
      const res = await fetch(`/api/race?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load race");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const monthLabel = data
    ? new Date(data.since).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <header className="text-center mb-8">
        <h1 className="race-title text-4xl md:text-6xl text-yellow-300 drop-shadow-[0_0_25px_rgba(253,224,71,0.4)]">
          🏁 GITHUB CODE RACE 🏁
        </h1>
        <p className="mt-3 text-zinc-300 text-base md:text-lg">
          Who shipped the most lines this month? Place your bets, devs.
        </p>
      </header>

      <OrgForm onStart={startRace} loading={loading} />

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
            title={`${data.org}/*  ·  ${monthLabel}`}
            subtitle={
              <>
                <span className="text-emerald-400">+{fmtNum(data.totalAdditions)}</span>{"  "}
                <span className="text-rose-400">-{fmtNum(data.totalDeletions)}</span>
                {"  ·  "}
                {fmtNum(data.totalCommits)} commits across {data.repos.length} repos
              </>
            }
            racers={data.racers}
            resetKey={data.generatedAt}
          />
          <Scoreboard racers={data.racers} />
          <RepoBreakdown repos={data.repos} since={data.since} />
          {data.warnings.length > 0 && (
            <details className="mt-8 rounded-lg border border-zinc-700 bg-zinc-900/40 p-3 text-sm text-zinc-400">
              <summary className="cursor-pointer text-zinc-300">
                {data.warnings.length} warning(s) — click to expand
              </summary>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
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
