"use client";

import { useEffect, useState } from "react";
import type { Racer } from "@/lib/types";
import type { RacePhase } from "./RaceTrack";

const COMMENTS_RACING: Array<(r: Racer) => string> = [
  (r) => `@${r.login} BURNS RUBBER WITH ${r.additions.toLocaleString()} LINES! 🔥`,
  (r) => `@${r.login} IS PUSHING COMMITS LIKE A MANIAC!`,
  (r) => `LADIES AND GENTS — @${r.login} LEADS THE PACK!`,
  (r) => `WHAT A SPRINT FROM @${r.login}!`,
  (r) => `@${r.login} JUST SLAMMED IN A MEGA-DIFF!`,
  (r) => `THE LINTER WEEPS — @${r.login} KEEPS GOING!`,
];

const COMMENTS_FINISHED: Array<(r: Racer) => string> = [
  (r) => `🏆 @${r.login} TAKES THE CHECKERED FLAG!`,
  (r) => `INCREDIBLE FINISH BY @${r.login} — MERGE IT, COWARDS!`,
  (r) => `@${r.login} CROSSES THE LINE. CODE REVIEWERS, BRACE YOURSELVES.`,
];

const COMMENTS_COUNTDOWN: Array<() => string> = [
  () => "Drivers, start your IDEs...",
  () => "Linters warming up...",
  () => "git fetch --all... GO!",
  () => "Pre-flight: rebase, lint, vibes.",
];

export default function Commentary({ lanes, phase }: { lanes: Racer[]; phase: RacePhase }) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (lanes.length === 0) return;
    function pick() {
      if (phase === "countdown") {
        const c = COMMENTS_COUNTDOWN[Math.floor(Math.random() * COMMENTS_COUNTDOWN.length)];
        setText(c());
      } else if (phase === "racing") {
        const r = lanes[Math.floor(Math.random() * Math.min(3, lanes.length))];
        const c = COMMENTS_RACING[Math.floor(Math.random() * COMMENTS_RACING.length)];
        setText(c(r));
      } else {
        const c = COMMENTS_FINISHED[Math.floor(Math.random() * COMMENTS_FINISHED.length)];
        setText(c(lanes[0]));
      }
    }
    pick();
    const id = setInterval(pick, 1600);
    return () => clearInterval(id);
  }, [phase, lanes]);

  return (
    <div className="mt-4 rounded-xl border border-yellow-300/30 bg-yellow-300/5 px-4 py-3 text-yellow-200">
      <span className="race-title text-yellow-300 mr-2">📣 COMMENTARY:</span>
      <span>{text || "..."}</span>
    </div>
  );
}
