"use client";

import { useEffect, useState } from "react";
import { saveOrg } from "@/lib/storage";

const SUGGESTIONS = ["vercel", "facebook", "microsoft", "vuejs"];

export type Period = { kind: "month"; value: string } | { kind: "week"; value: string };

function defaultMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ISO 8601 week of a UTC date.
function defaultWeek(): string {
  const now = new Date();
  // Set to Thursday of current week (ISO 8601 anchor).
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0, ..., Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  // First Thursday of the year.
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = Math.round(
    (target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000)
  ) + 1;
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export default function OrgForm({
  onStart,
  loading,
  initialOrg,
  initialPeriod,
}: {
  onStart: (org: string, period: Period) => void;
  loading: boolean;
  initialOrg?: string | null;
  initialPeriod?: Period | null;
}) {
  const [org, setOrg] = useState(initialOrg || "vercel");
  const [periodKind, setPeriodKind] = useState<"month" | "week">(
    initialPeriod?.kind || "month"
  );
  const [month, setMonth] = useState(
    initialPeriod?.kind === "month" ? initialPeriod.value : defaultMonth()
  );
  const [week, setWeek] = useState(
    initialPeriod?.kind === "week" ? initialPeriod.value : defaultWeek()
  );

  useEffect(() => {
    if (initialOrg) setOrg(initialOrg);
  }, [initialOrg]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = org.trim();
    if (!trimmed || loading) return;
    saveOrg(trimmed);
    const period: Period =
      periodKind === "week" ? { kind: "week", value: week } : { kind: "month", value: month };
    onStart(trimmed, period);
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-zinc-700 bg-zinc-900/60 backdrop-blur p-5 md:p-6 shadow-xl"
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto_auto_auto] items-end">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-zinc-400 mb-1">
            GitHub organization
          </span>
          <input
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="vercel"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 focus:outline-none focus:border-yellow-300"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div>
          <span className="block text-xs uppercase tracking-widest text-zinc-400 mb-1">Period</span>
          <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden">
            {(["month", "week"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriodKind(p)}
                disabled={loading}
                className={`px-3 py-2 text-sm transition ${
                  periodKind === p
                    ? "bg-yellow-300 text-zinc-900 race-title"
                    : "text-zinc-300 hover:text-yellow-300"
                }`}
              >
                {p === "month" ? "Month" : "Week"}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-zinc-400 mb-1">
            {periodKind === "week" ? "Week" : "Month"}
          </span>
          {periodKind === "week" ? (
            <input
              type="week"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              max={defaultWeek()}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 focus:outline-none focus:border-yellow-300"
              disabled={loading}
            />
          ) : (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              max={defaultMonth()}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 focus:outline-none focus:border-yellow-300"
              disabled={loading}
            />
          )}
        </label>

        <button
          type="submit"
          disabled={loading}
          className="race-title rounded-lg bg-yellow-300 text-zinc-900 px-6 py-3 hover:bg-yellow-200 transition disabled:opacity-50"
        >
          {loading ? "RACING..." : "START THE RACE!"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400 items-center">
        <span>Try a public org:</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={loading}
            onClick={() => setOrg(s)}
            className="rounded-full border border-zinc-700 px-2 py-0.5 hover:border-yellow-300 hover:text-yellow-300"
          >
            {s}
          </button>
        ))}
      </div>
    </form>
  );
}
