"use client";

import { useEffect, useState } from "react";
import { startOfWeek, endOfWeek, subWeeks, format } from "date-fns";
import { saveOrg } from "@/lib/storage";
import type { DateRangeValue } from "@/lib/types";

const SUGGESTIONS = ["vercel", "facebook", "microsoft", "vuejs"];

const WEEK_PRESETS = [
  { label: "This week", offset: 0 },
  { label: "Last week", offset: 1 },
  { label: "2 weeks ago", offset: 2 },
  { label: "3 weeks ago", offset: 3 },
];

function rangeForOffset(offset: number): DateRangeValue {
  const ref = subWeeks(new Date(), offset);
  return {
    from: startOfWeek(ref, { weekStartsOn: 1 }),
    to: endOfWeek(ref, { weekStartsOn: 1 }),
  };
}

export default function OrgForm({
  onStart,
  loading,
  initialOrg,
}: {
  onStart: (org: string, range: DateRangeValue) => void;
  loading: boolean;
  initialOrg?: string | null;
}) {
  const [org, setOrg] = useState(initialOrg || "vercel");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (initialOrg) setOrg(initialOrg);
  }, [initialOrg]);

  const range = rangeForOffset(offset);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = org.trim();
    if (!trimmed || loading) return;
    saveOrg(trimmed);
    onStart(trimmed, range);
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-zinc-700 bg-zinc-900/60 backdrop-blur p-5 md:p-6 shadow-xl"
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto] items-end">
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

        <button
          type="submit"
          disabled={loading}
          className="race-title rounded-lg bg-yellow-300 text-zinc-900 px-6 py-3 hover:bg-yellow-200 transition disabled:opacity-50"
        >
          {loading ? "RACING..." : "START THE RACE!"}
        </button>
      </div>

      <div className="mt-4">
        <span className="block text-xs uppercase tracking-widest text-zinc-400 mb-2">Week</span>
        <div className="flex flex-wrap gap-2">
          {WEEK_PRESETS.map((p) => {
            const active = p.offset === offset;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => setOffset(p.offset)}
                disabled={loading}
                className={`rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${
                  active
                    ? "bg-yellow-300 text-zinc-900 border-yellow-300 race-title"
                    : "border-zinc-700 text-zinc-200 hover:border-yellow-300 hover:text-yellow-300"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {format(range.from, "EEE, MMM d")} → {format(range.to, "EEE, MMM d, yyyy")}
        </p>
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
