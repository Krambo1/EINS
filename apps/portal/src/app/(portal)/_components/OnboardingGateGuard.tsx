"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isGateAllowedPath } from "./onboarding-gate-paths";

/**
 * Client half of the onboarding gate. The (portal) layout redirects to
 * /onboarding on a full page load, but a click in the sidebar only renders
 * the new page segment: the shared layout (and its `redirect`) does not run
 * again. While the gate is closed, this guard turns such a soft navigation
 * to a locked path into a full document load of that path. The server stays
 * the authority: if the gate is still closed, the layout answers with a 307
 * to /onboarding; if the Inhaber completed it meanwhile, the page renders.
 *
 * Not `router.refresh()`: a layout `redirect()` inside a client transition
 * makes the Next router navigate to /onboarding in an endless loop (thousands
 * of navigations, white page). `replace` instead of `assign` keeps the locked
 * URL out of the history, so Back does not land on it again.
 */
export function OnboardingGateGuard({ gateClosed }: { gateClosed: boolean }) {
  const pathname = usePathname();
  const reloadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!gateClosed || isGateAllowedPath(pathname)) {
      // Back on an allowed path (usually the redirect to /onboarding): a
      // later click on the same locked path must reload again, otherwise
      // the soft navigation shows the locked page (V2 UNCLEAR).
      reloadedFor.current = null;
      return;
    }
    // One reload per locked path (effects can run twice in dev).
    if (reloadedFor.current === pathname) return;
    reloadedFor.current = pathname;
    window.location.replace(`${pathname}${window.location.search}`);
  }, [gateClosed, pathname]);

  return null;
}
