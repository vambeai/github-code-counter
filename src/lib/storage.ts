const ORG_KEY = "gcr.org";

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

export function clearSavedOrg(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ORG_KEY);
  } catch {
    // ignore
  }
}
