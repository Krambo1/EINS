/**
 * Paths an un-onboarded Inhaber may still reach while the onboarding gate is
 * closed: the onboarding hub + its sub-pages, settings, and self-serve help.
 * Pure (no DB), shared by the server gate (`queries/onboardingGate.ts`) and
 * the client guard (`OnboardingGateGuard`).
 */
export const GATE_ALLOWED_PREFIXES = [
  "/onboarding",
  "/einstellungen",
  "/faq",
  "/feedback",
  "/support",
] as const;

export function isGateAllowedPath(pathname: string | null | undefined): boolean {
  // Unknown path (header missing) → never lock the user out.
  if (!pathname) return true;
  return GATE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}
