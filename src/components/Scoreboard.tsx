"use client";

import { useState } from "react";
import type { CommitInfo, Racer } from "@/lib/types";

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function Scoreboard({ racers }: { racers: Racer[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (racers.length === 0) return null;
  return (
    <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="race-title text-yellow-300">FULL SCOREBOARD</h3>
        <span className="text-xs text-zinc-500">
          {racers.length} contributors  ·  click a row to inspect commits
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-widest text-zinc-400">
            <tr>
              <th className="text-left px-4 py-2 w-10">#</th>
              <th className="text-left px-4 py-2">Racer</th>
              <th className="text-right px-4 py-2">+ Lines</th>
              <th className="text-right px-4 py-2">- Lines</th>
              <th className="text-right px-4 py-2">Commits</th>
              <th className="text-right px-4 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {racers.map((r, i) => {
              const isOpen = expanded === r.login;
              const hasCommits = r.commitList && r.commitList.length > 0;
              return (
                <RacerRows
                  key={r.login + i}
                  racer={r}
                  index={i}
                  isOpen={isOpen}
                  hasCommits={!!hasCommits}
                  onToggle={() =>
                    setExpanded(isOpen ? null : hasCommits ? r.login : null)
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RacerRows({
  racer,
  index,
  isOpen,
  hasCommits,
  onToggle,
}: {
  racer: Racer;
  index: number;
  isOpen: boolean;
  hasCommits: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`border-t border-zinc-800 ${
          hasCommits ? "cursor-pointer hover:bg-zinc-900/60" : ""
        } ${isOpen ? "bg-zinc-900/60" : ""}`}
        onClick={hasCommits ? onToggle : undefined}
      >
        <td className="px-4 py-2 text-zinc-500">{index + 1}</td>
        <td className="px-4 py-2">
          <a
            href={racer.htmlUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-2 hover:text-yellow-300"
          >
            {racer.avatarUrl && (
              <img src={racer.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
            )}
            @{racer.login}
          </a>
        </td>
        <td className="px-4 py-2 text-right text-emerald-400">+{fmtNum(racer.additions)}</td>
        <td className="px-4 py-2 text-right text-rose-400">-{fmtNum(racer.deletions)}</td>
        <td className="px-4 py-2 text-right">{fmtNum(racer.commits)}</td>
        <td className="px-4 py-2 text-right text-zinc-500">
          {hasCommits ? (isOpen ? "▲" : "▼") : ""}
        </td>
      </tr>
      {isOpen && hasCommits && racer.commitList && (
        <tr className="border-t border-zinc-800 bg-zinc-950/40">
          <td colSpan={6} className="px-4 py-3">
            <CommitsTable commits={racer.commitList} />
          </td>
        </tr>
      )}
    </>
  );
}

function CommitsTable({ commits }: { commits: CommitInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-widest text-zinc-500">
          <tr>
            <th className="text-left px-2 py-1">Date</th>
            <th className="text-left px-2 py-1">Repo</th>
            <th className="text-left px-2 py-1">Message</th>
            <th className="text-right px-2 py-1">+ Lines</th>
            <th className="text-right px-2 py-1">- Lines</th>
            <th className="text-right px-2 py-1">Filtered</th>
            <th className="text-right px-2 py-1">SHA</th>
          </tr>
        </thead>
        <tbody>
          {commits.map((c) => (
            <tr key={c.sha} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
              <td className="px-2 py-1 text-zinc-400 whitespace-nowrap">
                {fmtDate(c.committedDate)}
              </td>
              <td className="px-2 py-1 text-zinc-300 whitespace-nowrap">
                <a
                  href={`https://github.com/${c.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-yellow-300"
                >
                  {c.repo.split("/")[1]}
                </a>
              </td>
              <td className="px-2 py-1 text-zinc-200 max-w-md truncate" title={c.message}>
                <a
                  href={c.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-yellow-300"
                >
                  {c.message || "(no message)"}
                </a>
              </td>
              <td className="px-2 py-1 text-right text-emerald-400">+{fmtNum(c.additions)}</td>
              <td className="px-2 py-1 text-right text-rose-400">-{fmtNum(c.deletions)}</td>
              <td className="px-2 py-1 text-right text-zinc-500">
                {c.excludedFiles ? `${c.excludedFiles} file${c.excludedFiles === 1 ? "" : "s"}` : ""}
              </td>
              <td className="px-2 py-1 text-right">
                <a
                  href={c.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-zinc-500 hover:text-yellow-300"
                  title="Open commit on GitHub"
                >
                  {c.sha.slice(0, 7)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
