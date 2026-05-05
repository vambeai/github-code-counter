"use client";

import type { Racer } from "@/lib/types";

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

export default function Scoreboard({ racers }: { racers: Racer[] }) {
  if (racers.length === 0) return null;
  return (
    <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="race-title text-yellow-300">FULL SCOREBOARD</h3>
        <span className="text-xs text-zinc-500">{racers.length} contributors</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-widest text-zinc-400">
            <tr>
              <th className="text-left px-4 py-2">#</th>
              <th className="text-left px-4 py-2">Racer</th>
              <th className="text-right px-4 py-2">+ Lines</th>
              <th className="text-right px-4 py-2">- Lines</th>
              <th className="text-right px-4 py-2">Commits</th>
            </tr>
          </thead>
          <tbody>
            {racers.map((r, i) => (
              <tr key={r.login + i} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                <td className="px-4 py-2 text-zinc-500">{i + 1}</td>
                <td className="px-4 py-2">
                  <a
                    href={r.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 hover:text-yellow-300"
                  >
                    {r.avatarUrl && (
                      <img
                        src={r.avatarUrl}
                        alt=""
                        className="w-6 h-6 rounded-full object-cover"
                      />
                    )}
                    @{r.login}
                  </a>
                </td>
                <td className="px-4 py-2 text-right text-emerald-400">+{fmtNum(r.additions)}</td>
                <td className="px-4 py-2 text-right text-rose-400">-{fmtNum(r.deletions)}</td>
                <td className="px-4 py-2 text-right">{fmtNum(r.commits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
