"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminShell } from "./AdminShell";
import type { PendingOperations } from "@/server/queries/admin";

/** Zero badge counts used while the server layout's fetch briefly lags (see below). */
const EMPTY_COUNTS: PendingOperations = {
  slaBreaches: 0,
  animationsRequested: 0,
  animationsInProduction: 0,
  syncErrors: 0,
  stalledRequests: 0,
};

/** Pre-auth routes render bare (no nav chrome), matching the login card surface. */
const BARE_PATH_PREFIXES = [
  "/admin/login",
  "/admin/forgot-password",
  "/admin/set-password",
];

function isBarePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return BARE_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

interface AdminChromeGateProps {
  email: string | null;
  pendingCounts: PendingOperations | null;
  children: ReactNode;
}

/**
 * Picks bare-vs-chrome on the CLIENT from the live pathname, so the choice can't
 * be frozen by Next's layout cache.
 *
 * The previous server-only branch in `admin/layout.tsx` got stuck on its
 * login-time render: a shared layout is not re-rendered on soft navigation, so
 * after sign-in the /admin/login -> /admin transition reused the bare render and
 * the top-/side-nav only appeared after a hard refresh. `usePathname()`
 * re-evaluates on every navigation, so the nav shows the instant the path turns
 * authenticated (the nav itself is static — no session data needed to draw it).
 *
 * `email` and the operations badge come from the server layout, which can lag by
 * one render on a soft cross-boundary navigation (its cached copy still has the
 * logged-out session). The one-shot `router.refresh()` re-renders that layout
 * with the now-present session and fills them in, without a full reload.
 */
export function AdminChromeGate({
  email,
  pendingCounts,
  children,
}: AdminChromeGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const healed = useRef(false);

  const bare = isBarePath(pathname);

  useEffect(() => {
    // Returning to a bare route arms the heal again for the next sign-in.
    if (bare) {
      healed.current = false;
      return;
    }
    // Authenticated path but the layout render still carries no session => stale.
    // The page-level requireAdmin() guarantees a real session exists here, so a
    // single refresh fills email/counts rather than looping.
    if (!email && !healed.current) {
      healed.current = true;
      router.refresh();
    }
  }, [bare, email, router]);

  if (bare) {
    return (
      <div className="relative min-h-dvh bg-bg-primary">
        <div className="p-6 md:p-12">{children}</div>
      </div>
    );
  }

  return (
    <AdminShell email={email ?? ""} pendingCounts={pendingCounts ?? EMPTY_COUNTS}>
      {children}
    </AdminShell>
  );
}
