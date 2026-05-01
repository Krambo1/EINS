import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@eins/ui";
import { getAdminSession, isAllowedAdminIp } from "@/auth/admin";
import { AdminNav } from "./_components/AdminNav";
import { AdminBlob } from "./_components/AdminBlob";

/**
 * Admin shell. Renders navigation only when a session exists; auth is
 * enforced per-page via `requireAdmin()` so unauthenticated visits to
 * /admin/login and /admin/login/callback don't infinite-redirect.
 */

export const metadata = { title: "EINS Admin" };

const NAV_LINKS = [
  { href: "/admin", label: "Übersicht" },
  { href: "/admin/clinics", label: "Kliniken" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/leistung", label: "Leistung" },
  { href: "/admin/operations", label: "Operations" },
  { href: "/admin/audit", label: "Audit" },
];

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

  if (!session) {
    return (
      <div className="relative min-h-dvh bg-bg-primary">
        <AdminBlob />
        <div className="p-6 md:p-12">{children}</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh bg-bg-primary">
      <AdminBlob />

      <header className="sticky top-0 z-40 border-b border-border bg-bg-primary/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-6">
            <a href="/admin" className="flex items-center gap-3" aria-label="EINS Admin">
              <img
                src="/eins-logo.svg"
                alt="EINS Visuals"
                width={600}
                height={240}
                className="h-9 w-auto md:h-10"
              />
              <span className="hidden font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary sm:inline">
                Admin
              </span>
            </a>
            <span className="hidden h-5 w-px bg-border md:block" />
            <div className="hidden md:block">
              <AdminNav links={NAV_LINKS} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-fg-secondary md:inline">
              {session.email}
            </span>
            <form action="/admin/logout" method="post">
              <Button type="submit" variant="outline" size="sm">
                Abmelden
              </Button>
            </form>
          </div>
        </div>
        <div className="border-t border-border md:hidden">
          <div className="mx-auto max-w-6xl overflow-x-auto px-4 py-2">
            <AdminNav links={NAV_LINKS} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 md:py-14">{children}</main>
    </div>
  );
}
