const ORG_KEY = "gcr.org";
const PERIOD_KIND_KEY = "gcr.periodKind";

export function loadSavedOrg(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function saveOrg(org: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORG_KEY, org);
  } catch {
    // ignore (private mode, quota, etc.)
  }
}

export function loadSavedPeriodKind(): "month" | "week" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(PERIOD_KIND_KEY);
    return v === "month" || v === "week" ? v : null;
  } catch {
    return null;
  }
}

export function savePeriodKind(kind: "month" | "week"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERIOD_KIND_KEY, kind);
  } catch {
    // ignore
  }
}

export function clearSavedOrg(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ORG_KEY);
  } catch {
    // ignore
  }
}
