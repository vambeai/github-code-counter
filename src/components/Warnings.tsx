"use client";

import { useEffect, useState } from "react";
import type { Warning } from "@/lib/types";

function formatRateLimitReset(reset?: string): string | null {
  if (!reset) return null;
  const ts = parseInt(reset, 10);
  if (!Number.isFinite(ts)) return null;
  const date = new Date(ts * 1000);
  const inSeconds = Math.max(0, Math.round((ts * 1000 - Date.now()) / 1000));
  if (inSeconds === 0) return `${date.toLocaleString()} (already passed)`;
  if (inSeconds < 60) return `${date.toLocaleString()} (in ${inSeconds}s)`;
  return `${date.toLocaleString()} (in ${Math.round(inSeconds / 60)}m)`;
}

export default function Warnings({
  warnings,
  onRetry,
  retrying,
  warmingCount,
}: {
  warnings: Warning[];
  onRetry?: () => void;
  retrying?: boolean;
  warmingCount?: number;
}) {
  if (warnings.length === 0) return null;

  const stillComputingCount = warnings.filter((w) => w.lastStatus === 202).length;

  return (
    <details
      open
      className="mt-8 rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 text-sm text-amber-100"
    >
      <summary className="cursor-pointer text-amber-200 font-semibold">
        🟡 {warnings.length} repo{warnings.length === 1 ? "" : "s"} skipped — click to inspect raw
        GitHub responses
      </summary>

      {(stillComputingCount > 0 || warmingCount) && (
        <div className="mt-3 rounded-md border border-amber-700/40 bg-amber-900/20 p-3 text-amber-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold">🔥 GitHub is warming caches in the background</div>
            <div className="text-xs text-amber-200/80 mt-1">
              The server kept poking GitHub after your last request, so most of these should be
              ready in 30-60s. Successful repos are already cached on our side and won&apos;t be
              re-fetched.
            </div>
          </div>
          {onRetry && (
            <RetryButton onRetry={onRetry} retrying={!!retrying} />
          )}
        </div>
      )}

      <div className="mt-3 space-y-3">
        {warnings.map((w, i) => (
          <WarningCard key={i} warning={w} />
        ))}
      </div>
    </details>
  );
}

function RetryButton({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  // After mount, count down 30s and enable a "Retry now" affordance.
  const [secondsLeft, setSecondsLeft] = useState(30);
  useEffect(() => {
    if (retrying) return;
    setSecondsLeft(30);
    const id = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [retrying]);

  const ready = secondsLeft === 0;
  return (
    <button
      onClick={onRetry}
      disabled={retrying}
      className="race-title rounded-lg bg-yellow-300 text-zinc-900 px-4 py-2 hover:bg-yellow-200 transition disabled:opacity-50 whitespace-nowrap"
    >
      {retrying
        ? "RETRYING..."
        : ready
          ? "RETRY SKIPPED REPOS"
          : `RETRY IN ${secondsLeft}s (or now)`}
    </button>
  );
}

function WarningCard({ warning }: { warning: Warning }) {
  const reset = formatRateLimitReset(warning.rateLimit?.reset);
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-950/60 p-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <a
          href={`https://github.com/${warning.repo}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-zinc-100 hover:text-yellow-300 truncate"
        >
          {warning.repo}
        </a>
        <span className="text-xs text-zinc-400">
          HTTP {warning.lastStatus ?? "n/a"}  ·  {warning.attempts} attempt
          {warning.attempts === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-1 text-amber-200">{warning.reason}</div>
      <div className="text-zinc-300 text-xs mt-1">{warning.message}</div>

      {warning.rateLimit && (warning.rateLimit.limit || warning.rateLimit.remaining) && (
        <dl className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs text-zinc-400">
          {warning.rateLimit.resource && (
            <>
              <dt className="text-zinc-500">resource</dt>
              <dd>{warning.rateLimit.resource}</dd>
            </>
          )}
          {warning.rateLimit.remaining !== undefined && (
            <>
              <dt className="text-zinc-500">remaining</dt>
              <dd>
                {warning.rateLimit.remaining} / {warning.rateLimit.limit ?? "?"}
              </dd>
            </>
          )}
          {warning.rateLimit.used !== undefined && (
            <>
              <dt className="text-zinc-500">used</dt>
              <dd>{warning.rateLimit.used}</dd>
            </>
          )}
          {reset && (
            <>
              <dt className="text-zinc-500">resets</dt>
              <dd>{reset}</dd>
            </>
          )}
        </dl>
      )}

      {warning.requestId && (
        <div className="mt-2 text-xs text-zinc-500">
          GitHub request id: <span className="font-mono text-zinc-300">{warning.requestId}</span>
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
          Raw response headers + body
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-black/60 p-2 text-[11px] leading-relaxed text-zinc-200">
{JSON.stringify(
  {
    lastStatus: warning.lastStatus,
    attempts: warning.attempts,
    headers: warning.responseHeaders ?? {},
    body: warning.rawBody,
  },
  null,
  2
)}
        </pre>
      </details>
    </div>
  );
}
