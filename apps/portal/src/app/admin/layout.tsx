import { redirect } from "next/navigation";
import { getAdminSession, isAllowedAdminIp } from "@/auth/admin";
import { getTrustedClientIp } from "@/lib/client-ip";
import { pendingOperationCounts } from "@/server/queries/admin";
import { AdminShell } from "./_components/AdminShell";

/**
 * Admin shell. Two gates run here, both entirely SERVER-side:
 *
 *  1. IP allowlist: a non-allowlisted origin is bounced to "/".
 *  2. Bare-vs-chrome: keyed off the SESSION, not the pathname. No session =>
 *     bare surface (login / forgot-password / set-password sit on a clean
 *     background); session present => the full nav chrome (<AdminShell>).
 *
 * Why session-keyed and not path-keyed: the admin app lives behind an
 * `admin.*` host rewrite (see src/middleware.ts), so the browser-visible path
 * can be `/login` while the rendered route is `/admin/login`. The previous
 * client-side `usePathname()` branch matched the prefix `/admin/login`, so when
 * the visible path was the un-prefixed `/login` the check failed and the nav
 * chrome leaked onto the login page. Session presence has no such ambiguity.
 *
 * Why no refresh is needed after sign-in: login does a hard
 * `window.location.assign("/admin")` (see login/_components/LoginForm.tsx)
 * rather than a soft navigation, so this shared layout re-renders server-side
 * with the freshly-set session cookie and the chrome appears immediately, with
 * no `router.refresh()` heal. Soft navigation between two authenticated pages
 * keeps the already-mounted chrome, which is correct. (The hard-nav choice also
 * dodges the Next.js #65893 redirect bug under the host rewrite.)
 *
 * Auth itself stays enforced per-page via `requireAdmin()`; a missing session
 * just renders bare here and the page-level redirect to /admin/login takes over.
 * The admin boundary stays fully separate from the clinic session: IP allowlist
 * + `eins_admin_session` + `requireAdmin()`; the chrome lives in the app-local
 * `<AdminShell>` (a copy of the clinic `PortalShell`, no clinic-session coupling).
 */

export const metadata = { title: "EINS Admin" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ip = await getTrustedClientIp();
  if (!isAllowedAdminIp(ip)) redirect("/");

  const session = await getAdminSession();

  // No session => bare surface (matches the login card's clean background).
  if (!session) {
    return (
      <div className="relative min-h-dvh bg-bg-primary">
        <div className="p-6 md:p-12">{children}</div>
      </div>
    );
  }

  // Authenticated => full nav chrome.
  const pendingCounts = await pendingOperationCounts();

  return (
    <AdminShell email={session.email} pendingCounts={pendingCounts}>
      {children}
    </AdminShell>
  );
}
