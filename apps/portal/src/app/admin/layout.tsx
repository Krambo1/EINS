import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSession, isAllowedAdminIp } from "@/auth/admin";
import { pendingOperationCounts } from "@/server/queries/admin";
import { AdminChromeGate } from "./_components/AdminChromeGate";

/**
 * Admin shell. The IP allowlist gate runs here; the bare-vs-chrome choice is
 * delegated to <AdminChromeGate> (a client component) so it tracks the live
 * pathname instead of being frozen by Next's layout cache.
 *
 * Pre-auth routes (login, forgot-password, set-password) render bare so the
 * branded login card sits on a clean background; authenticated pages get the
 * nav chrome. Auth itself stays enforced per-page via `requireAdmin()` so an
 * unauthenticated visit redirects to /admin/login instead of looping. We fetch
 * the session here only to feed the chrome (email + operations badge); a missing
 * session just renders bare and the page redirect takes over.
 *
 * The admin boundary stays fully separate from the clinic session: IP allowlist
 * + `eins_admin_session` + `requireAdmin()`; the visual chrome lives in the
 * app-local `<AdminShell>` (a copy of the clinic `PortalShell`, no clinic
 * session coupling).
 */

export const metadata = { title: "EINS Admin" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const ip =
    (hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? "")
      .split(",")[0]
      ?.trim() || null;
  if (!isAllowedAdminIp(ip)) redirect("/");

  const session = await getAdminSession();
  const pendingCounts = session ? await pendingOperationCounts() : null;

  return (
    <AdminChromeGate email={session?.email ?? null} pendingCounts={pendingCounts}>
      {children}
    </AdminChromeGate>
  );
}
