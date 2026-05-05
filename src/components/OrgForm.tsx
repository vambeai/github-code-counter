"use client";

import { useEffect, useState } from "react";
import { startOfMonth, endOfMonth } from "date-fns";
import DateRangePicker, { type DateRangeValue } from "./DateRangePicker";
import { saveOrg } from "@/lib/storage";

const SUGGESTIONS = ["vercel", "facebook", "microsoft", "vuejs"];

export default function OrgForm({
  onStart,
  loading,
  initialOrg,
  initialRange,
}: {
  onStart: (org: string, range: DateRangeValue) => void;
  loading: boolean;
  initialOrg?: string | null;
  initialRange?: DateRangeValue | null;
}) {
  const [org, setOrg] = useState(initialOrg || "vercel");
  const [range, setRange] = useState<DateRangeValue | null>(() => {
    if (initialRange) return initialRange;
    const now = new Date();
    return { from: startOfMonth(now), to: endOfMonth(now) };
  });

  useEffect(() => {
    if (initialOrg) setOrg(initialOrg);
  }, [initialOrg]);

  useEffect(() => {
    if (initialRange) setRange(initialRange);
  }, [initialRange]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = org.trim();
    if (!trimmed || loading || !range) return;
    saveOrg(trimmed);
    onStart(trimmed, range);
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-zinc-700 bg-zinc-900/60 backdrop-blur p-5 md:p-6 shadow-xl"
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] items-end">
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
          <span className="block text-xs uppercase tracking-widest text-zinc-400 mb-1">
            Date range
          </span>
          <DateRangePicker value={range} onChange={setRange} disabled={loading} />
        </div>

        <button
          type="submit"
          disabled={loading || !range}
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
