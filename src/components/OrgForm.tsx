"use client";

import { useState } from "react";

const SUGGESTIONS = ["vercel", "facebook", "microsoft", "vuejs"];

export default function OrgForm({
  onStart,
  loading,
}: {
  onStart: (org: string, month: string) => void;
  loading: boolean;
}) {
  const [org, setOrg] = useState("vercel");
  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org.trim() || loading) return;
    onStart(org.trim(), month);
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
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-zinc-400 mb-1">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            max={defaultMonth}
            className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 focus:outline-none focus:border-yellow-300"
            disabled={loading}
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
