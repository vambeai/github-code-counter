"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarIcon } from "lucide-react";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { cn } from "@/lib/utils";

export type DateRangeValue = {
  from: Date;
  to: Date;
};

type Preset = {
  label: string;
  range: () => DateRangeValue;
};

const PRESETS: Preset[] = [
  {
    label: "This week",
    range: () => {
      const now = new Date();
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfWeek(now, { weekStartsOn: 1 }),
      };
    },
  },
  {
    label: "Last week",
    range: () => {
      const now = subDays(new Date(), 7);
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfWeek(now, { weekStartsOn: 1 }),
      };
    },
  },
  {
    label: "This month",
    range: () => {
      const now = new Date();
      return { from: startOfMonth(now), to: endOfMonth(now) };
    },
  },
  {
    label: "Last month",
    range: () => {
      const last = subMonths(new Date(), 1);
      return { from: startOfMonth(last), to: endOfMonth(last) };
    },
  },
  {
    label: "Last 7 days",
    range: () => {
      const now = new Date();
      return { from: subDays(now, 6), to: now };
    },
  },
  {
    label: "Last 30 days",
    range: () => {
      const now = new Date();
      return { from: subDays(now, 29), to: now };
    },
  },
];

function formatRangeLabel(value: DateRangeValue | null): string {
  if (!value) return "Pick a date range";
  const sameYear = value.from.getFullYear() === value.to.getFullYear();
  const fromFmt = sameYear ? "MMM d" : "MMM d, yyyy";
  return `${format(value.from, fromFmt)} — ${format(value.to, "MMM d, yyyy")}`;
}

export default function DateRangePicker({
  value,
  onChange,
  disabled,
}: {
  value: DateRangeValue | null;
  onChange: (value: DateRangeValue) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRange | undefined>(
    value ? { from: value.from, to: value.to } : undefined
  );

  React.useEffect(() => {
    if (value) setDraft({ from: value.from, to: value.to });
  }, [value]);

  function applyDraft() {
    if (draft?.from && draft?.to) {
      onChange({ from: draft.from, to: draft.to });
      setOpen(false);
    } else if (draft?.from) {
      // Single-day selection
      onChange({ from: draft.from, to: draft.from });
      setOpen(false);
    }
  }

  function applyPreset(preset: Preset) {
    const range = preset.range();
    setDraft({ from: range.from, to: range.to });
    onChange(range);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:border-yellow-300 transition focus:outline-none focus:border-yellow-300 disabled:opacity-50 min-w-[14rem] justify-between",
            !value && "text-zinc-400"
          )}
        >
          <span className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-zinc-400" />
            {formatRangeLabel(value)}
          </span>
          <span className="text-xs text-zinc-500">▾</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(
            "z-50 rounded-xl border border-zinc-700 bg-zinc-950/95 backdrop-blur shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="flex flex-col md:flex-row">
            <div className="flex flex-row md:flex-col gap-1 p-3 border-b md:border-b-0 md:border-r border-zinc-800 overflow-x-auto md:overflow-x-visible md:min-w-[10rem]">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 px-2 py-1 hidden md:block">
                Quick picks
              </div>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="text-left px-3 py-1.5 rounded-md text-sm text-zinc-200 hover:bg-zinc-800 hover:text-yellow-300 transition whitespace-nowrap"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="p-3">
              <DayPicker
                mode="range"
                numberOfMonths={2}
                selected={draft}
                onSelect={setDraft}
                weekStartsOn={1}
                showOutsideDays
                classNames={dpClassNames}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-xs text-zinc-400">
                  {draft?.from && draft?.to ? (
                    <>
                      {format(draft.from, "MMM d")} — {format(draft.to, "MMM d, yyyy")}
                    </>
                  ) : draft?.from ? (
                    <>From {format(draft.from, "MMM d, yyyy")}</>
                  ) : (
                    "Click a date to start"
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-yellow-300 hover:text-yellow-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyDraft}
                    disabled={!draft?.from}
                    className="race-title rounded-md bg-yellow-300 text-zinc-900 px-3 py-1 text-xs hover:bg-yellow-200 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const dpClassNames: Partial<Record<string, string>> = {
  months: "flex flex-col sm:flex-row gap-4",
  month: "space-y-3",
  caption: "flex justify-center pt-1 relative items-center text-zinc-200",
  caption_label: "text-sm font-semibold",
  nav: "flex items-center gap-1",
  nav_button:
    "inline-flex items-center justify-center rounded-md border border-zinc-700 hover:border-yellow-300 hover:text-yellow-300 h-7 w-7 text-zinc-300",
  nav_button_previous: "absolute left-1",
  nav_button_next: "absolute right-1",
  table: "w-full border-collapse space-y-1",
  head_row: "flex",
  head_cell: "text-zinc-500 rounded-md w-8 font-normal text-[0.7rem] uppercase tracking-widest",
  row: "flex w-full mt-1",
  cell:
    "h-8 w-8 text-center text-sm p-0 relative [&:has([aria-selected])]:bg-yellow-300/10 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
  day: "h-8 w-8 p-0 font-normal text-zinc-200 hover:bg-zinc-800 rounded-md aria-selected:opacity-100",
  day_selected:
    "bg-yellow-300 text-zinc-900 hover:bg-yellow-200 hover:text-zinc-900 focus:bg-yellow-300 focus:text-zinc-900",
  day_today: "border border-yellow-300/50",
  day_outside: "text-zinc-600 opacity-50",
  day_disabled: "text-zinc-700 opacity-50",
  day_range_start: "rounded-l-md",
  day_range_end: "rounded-r-md",
  day_range_middle: "bg-yellow-300/20 text-zinc-100 rounded-none",
  day_hidden: "invisible",
};
