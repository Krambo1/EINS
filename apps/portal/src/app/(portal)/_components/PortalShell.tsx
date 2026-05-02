"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { DetailToggle, type UiMode, cn } from "@eins/ui";
import {
  LayoutDashboard,
  Inbox,
  BarChart3,
  Megaphone,
  Film,
  Clapperboard,
  FileText,
  BookOpen,
  Gem,
  Settings,
  Calculator,
  MessageSquare,
  LogOut,
} from "lucide-react";
import { ROLE_LABELS, PLAN_LABELS, type Role } from "@/lib/constants";
import { can } from "@/lib/roles";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { DetailIntroToast } from "./DetailIntroToast";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Parameters<typeof can>[1];
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Übersicht", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/anfragen", label: "Anfragen", icon: Inbox, permission: "requests.view" },
  { href: "/auswertung", label: "Auswertung", icon: BarChart3, permission: "reports.view" },
  { href: "/werbebudget", label: "Werbebudget", icon: Megaphone, permission: "campaigns.live" },
  { href: "/medien", label: "Medien", icon: Film, permission: "assets.view" },
  { href: "/animationen", label: "Animationen", icon: Clapperboard, permission: "animations.view" },
  { href: "/dokumente", label: "Dokumente", icon: FileText, permission: "documents.view.all_roles" },
  { href: "/leitfaden", label: "Vertriebsleitfaden", icon: BookOpen, permission: "documents.view.marketing" },
  { href: "/plan", label: "Paket", icon: Gem, permission: "plan.view" },
  { href: "/was-waere-wenn", label: "Was-wäre-wenn", icon: Calculator, permission: "tools.what_if" },
  { href: "/feedback", label: "Feedback", icon: MessageSquare, permission: "feedback.submit" },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings, permission: "settings.team" },
];

interface PortalShellProps {
  user: {
    email: string;
    fullName: string | null;
    role: Role;
    uiMode: UiMode;
  };
  clinic: {
    id: string;
    displayName: string;
    plan: string;
    logoUrl: string | null;
  };
  /** Set when an admin opened this session via "View as user". */
  impersonating: boolean;
  children: ReactNode;
}

export function PortalShell({ user, clinic, impersonating, children }: PortalShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const visibleNav = NAV.filter((n) => !n.permission || can(user.role, n.permission));

  const onModeChange = async (mode: UiMode) => {
    await fetch("/api/me/ui-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg-primary">
      {impersonating && (
        <ImpersonationBanner
          targetEmail={user.email}
          clinicName={clinic.displayName}
        />
      )}
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg-primary/95 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-4 px-4 py-3 md:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            {clinic.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clinic.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/eins-logo.svg"
                alt="EINS Visuals"
                width={600}
                height={240}
                className="h-9 w-auto md:h-10"
              />
            )}
            <div className="hidden flex-col leading-tight md:flex">
              <span className="text-base font-semibold">{clinic.displayName || "EINS Portal"}</span>
              <span className="text-xs text-fg-secondary">
                Paket {PLAN_LABELS[clinic.plan as keyof typeof PLAN_LABELS] ?? clinic.plan}
              </span>
            </div>
          </Link>

          <div className="flex-1" />

          <DetailToggle value={user.uiMode} onChange={onModeChange} />

          <div className="hidden items-center gap-3 md:flex">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{user.fullName ?? user.email}</div>
              <div className="text-xs text-fg-secondary">{ROLE_LABELS[user.role]}</div>
            </div>
            <a
              href="/api/auth/logout"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
              aria-label="Abmelden"
            >
              <LogOut className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-screen-2xl flex-1 gap-8 px-4 py-6 md:px-6">
        {/* Side nav */}
        <nav className="sticky top-20 hidden h-[calc(100dvh-6rem)] w-56 shrink-0 flex-col gap-1 self-start md:flex">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2 text-base transition",
                  active
                    ? "bg-accent/10 font-semibold text-accent before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r before:bg-accent"
                    : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile nav (scrollable horizontal tabs) */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto border-t border-border bg-bg-primary px-2 py-2 md:hidden">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-[4.5rem] flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px]",
                  active ? "bg-accent/10 font-semibold text-accent" : "text-fg-secondary"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 pb-24 md:pb-6">{children}</main>
      </div>
      <DetailIntroToast uiMode={user.uiMode} />
    </div>
  );
}
