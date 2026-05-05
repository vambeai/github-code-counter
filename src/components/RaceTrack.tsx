"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Racer } from "@/lib/types";
import Commentary from "./Commentary";

const VEHICLES = ["🏎️", "🚗", "🚙", "🚕", "🛻", "🚜", "🛵", "🏇", "🚴", "🏃", "🚀", "🦔"];
const RACE_DURATION_S = 6;

export type RacePhase = "countdown" | "racing" | "finished";

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

export default function RaceTrack({
  title,
  subtitle,
  racers,
  maxLanes = 10,
  resetKey,
}: {
  title: string;
  subtitle?: React.ReactNode;
  racers: Racer[];
  maxLanes?: number;
  resetKey: string;
}) {
  const lanes = useMemo(() => racers.slice(0, maxLanes), [racers, maxLanes]);
  const maxAdditions = lanes[0]?.additions || 1;
  const [phase, setPhase] = useState<RacePhase>("countdown");
  const [count, setCount] = useState(3);

  useEffect(() => {
    setPhase("countdown");
    setCount(3);
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        setCount(0);
        setPhase("racing");
        const t = setTimeout(() => setPhase("finished"), RACE_DURATION_S * 1000);
        cleanups.push(() => clearTimeout(t));
      } else {
        setCount(n);
      }
    }, 800);
    const cleanups: Array<() => void> = [() => clearInterval(id)];
    return () => cleanups.forEach((c) => c());
  }, [resetKey]);

  function replay() {
    setPhase("countdown");
    setCount(3);
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        setCount(0);
        setPhase("racing");
        setTimeout(() => setPhase("finished"), RACE_DURATION_S * 1000);
      } else {
        setCount(n);
      }
    }, 800);
  }

  return (
    <section className="mt-8">
      <div className="rounded-3xl border border-zinc-700 bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 p-4 md:p-6 shadow-2xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="race-title text-2xl md:text-3xl text-yellow-300">{title}</h2>
            {subtitle && <p className="text-zinc-400 text-sm mt-1">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={replay}
              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:border-yellow-300 hover:text-yellow-300 transition"
            >
              ▶ Replay
            </button>
            <span className="text-3xl flag">🏁</span>
          </div>
        </div>

        {phase === "countdown" && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
            <div className="race-title text-8xl md:text-9xl text-yellow-300 drop-shadow-[0_0_25px_rgba(253,224,71,0.6)]">
              {count}
            </div>
          </div>
        )}

        {lanes.length === 0 ? (
          <div className="text-zinc-400 text-center py-12">
            No commits with line changes for this period. Try another month or org.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {lanes.map((racer, i) => (
              <Lane
                key={racer.login + i}
                racer={racer}
                index={i}
                maxAdditions={maxAdditions}
                phase={phase}
              />
            ))}
          </div>
        )}
      </div>

      {lanes.length > 0 && <Commentary lanes={lanes} phase={phase} />}
      {phase === "finished" && lanes.length > 0 && <Podium racers={lanes.slice(0, 3)} />}
    </section>
  );
}

function Lane({
  racer,
  index,
  maxAdditions,
  phase,
}: {
  racer: Racer;
  index: number;
  maxAdditions: number;
  phase: RacePhase;
}) {
  const vehicle = VEHICLES[index % VEHICLES.length];
  const target = Math.max(0.02, racer.additions / maxAdditions);
  const targetLeftPct = 2 + target * 90;
  const racing = phase !== "countdown";

  return (
    <div className="flex items-center gap-2 md:gap-3 h-14 md:h-16">
      <div className="w-7 md:w-9 shrink-0 text-center">
        <div className="pixel text-[9px] md:text-[10px] text-zinc-500">L{index + 1}</div>
      </div>
      <div className="hidden sm:flex items-center gap-2 w-44 shrink-0">
        {racer.avatarUrl ? (
          <img
            src={racer.avatarUrl}
            alt={racer.login}
            className="w-9 h-9 rounded-full border-2 border-yellow-300 bg-zinc-700 object-cover"
          />
        ) : (
          <div className="w-9 h-9 rounded-full border-2 border-yellow-300 bg-zinc-700" />
        )}
        <div className="min-w-0">
          <a
            href={racer.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-sm text-zinc-100 truncate font-semibold hover:text-yellow-300"
          >
            @{racer.login}
          </a>
          <div className="text-xs text-emerald-400 truncate">+{fmtNum(racer.additions)} lines</div>
        </div>
      </div>
      <div
        className={`relative flex-1 h-full rounded-lg bg-gradient-to-r from-zinc-800/80 to-zinc-900/80 border border-zinc-800 overflow-hidden track-bg ${
          racing && phase === "racing" ? "track-bg-animated" : ""
        }`}
      >
        <div className="absolute right-1 top-1/2 -translate-y-1/2 text-lg opacity-70 pointer-events-none">
          🏁
        </div>
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 text-2xl md:text-3xl select-none"
          initial={{ left: "2%" }}
          animate={{ left: racing ? `${targetLeftPct}%` : "2%" }}
          transition={{ duration: RACE_DURATION_S, ease: [0.16, 0.84, 0.44, 1] }}
        >
          {vehicle}
        </motion.div>
      </div>
      <div className="hidden md:block w-24 shrink-0 text-right">
        <div className="text-emerald-400 text-sm font-bold">+{fmtNum(racer.additions)}</div>
        <div className="text-rose-400 text-[11px]">-{fmtNum(racer.deletions)}</div>
      </div>
    </div>
  );
}

function Podium({ racers }: { racers: Racer[] }) {
  const order = [racers[1], racers[0], racers[2]].filter(Boolean) as Racer[];
  const heights = ["h-20", "h-32", "h-16"];
  const medals = ["🥈", "🥇", "🥉"];
  const labels = ["2", "1", "3"];
  return (
    <div className="mt-6 flex items-end justify-center gap-3 md:gap-6">
      {order.map((r, i) => (
        <div key={r.login} className="flex flex-col items-center w-24 md:w-32">
          <div className="text-3xl md:text-4xl">{medals[i]}</div>
          {r.avatarUrl && (
            <img
              src={r.avatarUrl}
              alt={r.login}
              className="w-10 h-10 md:w-12 md:h-12 rounded-full border-2 border-yellow-300 my-1 object-cover"
            />
          )}
          <a
            href={r.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs md:text-sm text-zinc-100 truncate max-w-full hover:underline"
          >
            @{r.login}
          </a>
          <div className="text-xs text-emerald-400">+{r.additions.toLocaleString()}</div>
          <div
            className={`mt-2 w-full ${heights[i]} rounded-t-lg bg-gradient-to-t from-yellow-700 to-yellow-300 flex items-start justify-center pt-1 race-title text-zinc-900`}
          >
            {labels[i]}
          </div>
        </div>
      ))}
    </div>
  );
}
