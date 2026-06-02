import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSession, isAllowedAdminIp } from "@/auth/admin";
import { pendingOperationCounts } from "@/server/queries/admin";
import { AdminShell } from "./_components/AdminShell";

/**
 * Admin shell. Renders the nav chrome for authenticated app pages. Pre-auth
 * routes (login, callback, forgot-password, set-password) render bare so the
 * branded login card sits on a clean background instead of inside the
 * "you're logged in" frame; auth is enforced per-page via `requireAdmin()`
 * so unauthenticated visits don't infinite-redirect.
 *
 * The admin boundary stays fully separate from the clinic session: IP allowlist
 * + `eins_admin_session` + `requireAdmin()` here; the visual chrome lives in the
 * app-local `<AdminShell>` (a copy of the clinic `PortalShell`, no clinic
 * session coupling).
 */

export const metadata = { title: "EINS Admin" };

const BARE_PATH_PREFIXES = [
  "/admin/login",
  "/admin/forgot-password",
  "/admin/set-password",
];

function isBarePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return BARE_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`)
  );
}

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

  const pathname = hdrs.get("x-portal-pathname");
  const session = await getAdminSession();

  if (!session || isBarePath(pathname)) {
    return (
      <div className="relative min-h-dvh bg-bg-primary">
        <div className="p-6 md:p-12">{children}</div>
      </div>
    );
  }

  return (
    <AdminShell email={session.email} pendingCounts={await pendingOperationCounts()}>
      {children}
    </AdminShell>
  );
}
