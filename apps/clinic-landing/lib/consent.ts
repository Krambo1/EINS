/**
 * Consent state management.
 *
 * Three categories per TDDDG / DSGVO:
 *   - essential   — always on (functional cookies, fonts)
 *   - statistik   — first-party RUM (always-on by default? NO — opt-in)
 *   - marketing   — Meta / Google / TikTok pixel + CAPI relay
 *
 * Default state pre-decision: ALL non-essential categories OFF.
 * State is stored in localStorage as a JSON object so future edits keep
 * compatibility (a string-only "all"/"essential" was too lossy).
 */

const STORAGE_KEY = "clinic-consent-v2";
export const CONSENT_CHANGE_EVENT = "clinic:consent-change";
export const OPEN_CONSENT_EVENT = "clinic:open-consent";

export interface ConsentState {
  essential: true;
  statistik: boolean;
  marketing: boolean;
  /** ISO timestamp of decision. */
  decidedAt: string | null;
}

export const DEFAULT_CONSENT: ConsentState = {
  essential: true,
  statistik: false,
  marketing: false,
  decidedAt: null,
};

export function readConsent(): ConsentState {
  if (typeof window === "undefined") return DEFAULT_CONSENT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONSENT;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    return {
      essential: true,
      statistik: Boolean(parsed.statistik),
      marketing: Boolean(parsed.marketing),
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : null,
    };
  } catch {
    return DEFAULT_CONSENT;
  }
}

export function writeConsent(next: Omit<ConsentState, "essential" | "decidedAt">) {
  if (typeof window === "undefined") return;
  const state: ConsentState = {
    essential: true,
    statistik: next.statistik,
    marketing: next.marketing,
    decidedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: state }));
  } catch {
    // ignore storage errors (private mode, full quota)
  }
}

export function hasDecided(state: ConsentState): boolean {
  return state.decidedAt !== null;
}

export function openConsentSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}
