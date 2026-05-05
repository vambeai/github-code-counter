"use client";

import { useState } from "react";
import RaceTrack from "./RaceTrack";
import type { RepoRace } from "@/lib/types";

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

export default function RepoBreakdown({ repos, since }: { repos: RepoRace[]; since: string }) {
  const [openRepo, setOpenRepo] = useState<string | null>(null);

  if (repos.length === 0) {
    return null;
  }

  const maxAdditions = repos[0]?.totalAdditions || 1;
  const monthLabel = new Date(since).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <section className="mt-12">
      <header className="flex items-end justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="race-title text-2xl text-yellow-300">PIT LANE — PER REPO</h2>
          <p className="text-zinc-400 text-sm">
            {repos.length} repos shipped code in {monthLabel}. Click any repo for its own race.
          </p>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {repos.map((repo) => {
          const widthPct = Math.max(2, (repo.totalAdditions / maxAdditions) * 100);
          const open = openRepo === repo.fullName;
          return (
            <div
              key={repo.fullName}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
            >
              <button
                onClick={() => setOpenRepo(open ? null : repo.fullName)}
                className="w-full text-left p-4 hover:bg-zinc-900 transition"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="race-title text-zinc-100 truncate">{repo.name}</span>
                      {repo.private && (
                        <span className="text-[10px] uppercase tracking-widest border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-400">
                          private
                        </span>
                      )}
                      {repo.truncated && (
                        <span
                          title={repo.truncationNote}
                          className="text-[10px] uppercase tracking-widest border border-amber-700/60 rounded px-1.5 py-0.5 text-amber-300"
                        >
                          partial
                        </span>
                      )}
                    </div>
                    <a
                      href={repo.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-zinc-500 hover:text-yellow-300 truncate"
                    >
                      {repo.fullName} ↗
                    </a>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <div className="text-emerald-400 font-bold text-sm">
                      +{fmtNum(repo.totalAdditions)}
                    </div>
                    <div className="text-rose-400">-{fmtNum(repo.totalDeletions)}</div>
                    <div className="text-zinc-500">{fmtNum(repo.totalCommits)} commits</div>
                  </div>
                </div>
                <div className="h-2 rounded bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-300 to-emerald-400"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {repo.racers.slice(0, 5).map((r) => (
                    <a
                      key={r.login}
                      href={r.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`@${r.login} — +${fmtNum(r.additions)}`}
                    >
                      {r.avatarUrl ? (
                        <img
                          src={r.avatarUrl}
                          alt={r.login}
                          className="w-7 h-7 rounded-full border border-zinc-700 hover:border-yellow-300 object-cover"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full border border-zinc-700 bg-zinc-800" />
                      )}
                    </a>
                  ))}
                  {repo.racers.length > 5 && (
                    <span className="text-xs text-zinc-500">
                      +{repo.racers.length - 5} more
                    </span>
                  )}
                  <span className="ml-auto text-xs text-zinc-500">
                    {open ? "Hide race ▲" : "Show race ▼"}
                  </span>
                </div>
              </button>
              {open && (
                <div className="border-t border-zinc-800 p-3 bg-zinc-950/40">
                  <RaceTrack
                    title={repo.name}
                    subtitle={`+${fmtNum(repo.totalAdditions)}  ·  ${fmtNum(
                      repo.totalCommits
                    )} commits`}
                    racers={repo.racers}
                    maxLanes={8}
                    resetKey={repo.fullName}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
