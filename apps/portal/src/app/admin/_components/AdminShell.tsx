"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button, cn } from "@eins/ui";
import {
  LayoutDashboard,
  Building2,
  Inbox,
  TrendingUp,
  ListChecks,
  Plug,
  Database,
  BadgeEuro,
  Rocket,
  Route,
  Users,
  ScrollText,
  Menu,
} from "lucide-react";
import { TopProgressBar } from "@/app/(portal)/_components/TopProgressBar";
import { GlobalSearch } from "@/app/(portal)/_components/GlobalSearch";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { EinsLogo } from "@/app/_components/EinsLogo";
import type { PendingOperations } from "@/server/queries/admin";

// Lazy-load the dialog so cmdk + the admin index + icons don't ship on every
// admin route. Once loaded we keep it mounted so subsequent opens are instant.
const AdminSearchDialog = dynamic(
  () => import("./AdminSearchDialog").then((m) => m.AdminSearchDialog),
  { ssr: false }
);

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When set, render an open-count badge fed by `pendingCounts`. */
  badge?: "operations";
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Steuerung",
    items: [
      { href: "/admin", label: "Übersicht", icon: LayoutDashboard },
      { href: "/admin/clinics", label: "Praxen", icon: Building2 },
    ],
  },
  {
    label: "Akquise",
    items: [
      { href: "/admin/leads", label: "Anfragen", icon: Inbox },
      { href: "/admin/leistung", label: "Leistung", icon: TrendingUp },
    ],
  },
  {
    label: "Betrieb",
    items: [
      { href: "/admin/operations", label: "Operations", icon: ListChecks, badge: "operations" },
      { href: "/admin/integrations", label: "Integrationen", icon: Plug },
      { href: "/admin/pvs-bridge", label: "PVS-Bridge", icon: Database },
    ],
  },
  {
    label: "Wachstum",
    items: [
      { href: "/admin/revenue", label: "Umsatz", icon: BadgeEuro },
      { href: "/admin/onboarding", label: "Onboarding", icon: Rocket },
      { href: "/admin/journey", label: "Standard-Journey", icon: Route },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/users", label: "Nutzer", icon: Users },
      { href: "/admin/audit", label: "Audit", icon: ScrollText },
    ],
  },
];

/** Group anchored to the bottom of the sidenav as a settings-style footer. */
const BOTTOM_ANCHORED_GROUP = "System";

/** Total open operations items — drives the Operations nav badge. */
function operationsBadgeTotal(p: PendingOperations): number {
  return (
    p.slaBreaches +
    p.animationsRequested +
    p.animationsInProduction +
    p.syncErrors +
    p.stalledRequests
  );
}

function badgeText(value: number, cap: number): string | null {
  if (value <= 0) return null;
  return value > cap ? `${cap}+` : String(value);
}

interface AdminShellProps {
  email: string;
  pendingCounts: PendingOperations;
  children: ReactNode;
}

/**
 * Admin chrome — the clinic-portal sidebar shell, copied for the admin boundary
 * and stripped of every clinic-session concern (no `clinic` prop, no role
 * filtering, no impersonation banner, no UserMenu). Keeps the sliding active
 * pill, mobile drawer (body-scroll-lock + Escape + edge-swipe) and top progress
 * bar. Auth stays entirely in `admin/layout.tsx`; this component only renders.
 */
export function AdminShell({ email, pendingCounts, children }: AdminShellProps) {
  const pathname = usePathname();

  const allHrefs = useMemo<string[]>(
    () => NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    []
  );

  // Most-specific match wins; "/admin" only matches itself (it's a prefix of
  // every other admin route).
  const activeHref = useMemo(() => {
    return allHrefs
      .filter((h) =>
        h === "/admin"
          ? pathname === "/admin"
          : pathname === h || pathname.startsWith(`${h}/`)
      )
      .sort((a, b) => b.length - a.length)[0];
  }, [allHrefs, pathname]);

  // Nav-click feedback → top progress bar (cleared once pathname matches).
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pendingHrefRef = useRef<string | null>(null);
  pendingHrefRef.current = pendingHref;

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Global search palette. State lives here (not in <GlobalSearch>) so the
  // trigger can render twice (desktop rail + mobile drawer) without
  // duplicating the dialog. `loaded` gates the dynamic import — once true
  // the dialog stays mounted for instant re-opens.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const openSearchPalette = () => {
    setSearchLoaded(true);
    setSearchOpen(true);
  };

  // Desktop sidenav sliding pill — track top/left/width/height of the active
  // item so the pill follows font-load / route changes.
  const desktopItemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [desktopPill, setDesktopPill] = useState<
    { top: number; left: number; width: number; height: number } | null
  >(null);

  useEffect(() => {
    const target = pendingHrefRef.current;
    if (!target) return;
    if (pathname === target || pathname.startsWith(`${target}/`)) {
      setPendingHref(null);
    }
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) return;
    const t = setTimeout(() => setPendingHref(null), 8000);
    return () => clearTimeout(t);
  }, [pendingHref]);

  // Close drawer on route change.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Body-scroll-lock while drawer open.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileNavOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  // Global search keyboard shortcuts. ⌘/Ctrl-K toggles the palette; "/" opens
  // it but only when the user isn't typing into a form control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const isPalette = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isPalette) {
        e.preventDefault();
        setSearchLoaded(true);
        setSearchOpen((v) => !v);
        return;
      }
      if (e.key === "/") {
        const t = e.target as HTMLElement | null;
        if (!t) return;
        const tag = t.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          t.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        setSearchLoaded(true);
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Edge-swipe: right-swipe from the left edge opens the drawer; left-swipe
  // closes it. Mobile only.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const EDGE = 28;
    const THRESHOLD = 60;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      if (!mq.matches) return;
      const t = e.touches[0];
      if (!t) return;
      if (mobileNavOpen) {
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
        return;
      }
      if (t.clientX > EDGE) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (Math.abs(dx) <= dy) return;
      if (!mobileNavOpen && dx > THRESHOLD) {
        tracking = false;
        setMobileNavOpen(true);
      } else if (mobileNavOpen && -dx > THRESHOLD) {
        tracking = false;
        setMobileNavOpen(false);
      }
    };
    const onEnd = () => {
      tracking = false;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [mobileNavOpen]);

  // Measure the active item + observe all items so the pill follows resizes.
  useEffect(() => {
    if (!activeHref) return;
    const measure = () => {
      const el = desktopItemRefs.current[activeHref];
      if (!el) return;
      setDesktopPill({
        top: el.offsetTop,
        left: el.offsetLeft,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    Object.values(desktopItemRefs.current).forEach((el) => {
      if (el) ro.observe(el);
    });
    return () => ro.disconnect();
  }, [activeHref]);

  const operationsBadge = badgeText(operationsBadgeTotal(pendingCounts), 99);
  const showProgress = pendingHref !== null;

  const renderNav = (variant: "desktop" | "mobile") =>
    NAV_GROUPS.map((group) => (
      <div
        key={group.label}
        className={cn(
          "flex flex-col gap-0.5",
          group.label === BOTTOM_ANCHORED_GROUP && "mt-auto"
        )}
      >
        <h3 className="px-3 pb-1 text-[0.7rem] font-medium text-fg-tertiary">
          {group.label}
        </h3>
        {group.items.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const badge = item.badge === "operations" ? operationsBadge : null;

          if (variant === "desktop") {
            return (
              <Link
                key={item.href}
                ref={(el) => {
                  desktopItemRefs.current[item.href] = el;
                }}
                href={item.href}
                prefetch={active ? false : true}
                onClick={active ? undefined : () => setPendingHref(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative z-10 flex items-center gap-3 rounded-xl px-3 py-1.5 text-base transition-colors duration-300",
                  active
                    ? "font-semibold text-bg-primary"
                    : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
                  active && !desktopPill &&
                    "bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
                {badge && (
                  <span
                    className={cn(
                      "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
                      active
                        ? "bg-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                        : "bg-[var(--tone-good-bg)]"
                    )}
                    aria-label={`${badge} offen`}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={active ? false : true}
              onClick={
                active
                  ? () => setMobileNavOpen(false)
                  : () => setPendingHref(item.href)
              }
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-2 text-base transition-colors",
                active
                  ? "bg-fg-primary font-semibold text-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                  : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{item.label}</span>
              {badge && (
                <span
                  className={cn(
                    "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
                    active
                      ? "bg-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                      : "bg-[var(--tone-good-bg)]"
                  )}
                  aria-label={`${badge} offen`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    ));

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg-primary">
      <TopProgressBar active={showProgress} />

      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b border-border backdrop-blur"
        style={{ backgroundColor: "color-mix(in srgb, var(--bg-primary) 95%, transparent)" }}
      >
        <div className="mx-auto flex max-w-screen-2xl items-center gap-4 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Menü öffnen"
            aria-expanded={mobileNavOpen}
            aria-controls="admin-nav-drawer"
            className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-primary hover:bg-bg-secondary md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <Link href="/admin" className="flex items-center gap-3 md:pl-3" aria-label="EINS Admin">
            <EinsLogo className="h-9 w-auto md:h-10" />
            <span aria-hidden="true" className="hidden h-7 w-px bg-border md:block" />
            <span className="hidden text-base font-semibold sm:inline">
              Admin
            </span>
          </Link>

          <div className="flex-1" />

          <span className="hidden text-sm text-fg-secondary md:inline">{email}</span>
          <ThemeToggle />
          <form action="/admin/logout" method="post">
            <Button type="submit" variant="outline" size="sm">
              Abmelden
            </Button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-screen-2xl flex-1 gap-8 px-4 py-6 md:px-6">
        {/* Desktop side rail */}
        <div className="sticky top-20 hidden h-[calc(100dvh-6rem)] w-56 shrink-0 flex-col gap-3 self-start overflow-y-auto pr-1 md:flex">
          <GlobalSearch onOpen={openSearchPalette} />
          <nav aria-label="Hauptnavigation" className="relative flex flex-1 flex-col gap-4">
            {desktopPill && (
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 rounded-xl bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)] transition-[transform,width,height] duration-300 ease-out will-change-transform"
                style={{
                  transform: `translate3d(${desktopPill.left}px, ${desktopPill.top}px, 0)`,
                  width: desktopPill.width,
                  height: desktopPill.height,
                }}
              />
            )}
            {renderNav("desktop")}
          </nav>
        </div>

        {/* Mobile nav drawer */}
        <div
          id="admin-nav-drawer"
          aria-hidden={!mobileNavOpen}
          className={cn(
            "fixed inset-0 z-50 md:hidden",
            !mobileNavOpen && "pointer-events-none"
          )}
        >
          <div
            onClick={() => setMobileNavOpen(false)}
            className={cn(
              "absolute inset-0 bg-black/40 transition-opacity duration-300",
              mobileNavOpen ? "opacity-100" : "opacity-0"
            )}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Hauptnavigation"
            className={cn(
              "absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-3 overflow-y-auto bg-bg-primary px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl transition-transform duration-300 ease-out",
              mobileNavOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="flex items-center gap-3 pb-1">
              <EinsLogo className="h-9 w-auto" />
              <span className="truncate text-base font-semibold">
                Admin
              </span>
            </div>
            <GlobalSearch onOpen={openSearchPalette} />
            <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-4">
              {renderNav("mobile")}
            </nav>
          </aside>
        </div>

        <main className="min-w-0 flex-1 pb-[max(5rem,env(safe-area-inset-bottom))]">
          {children}
        </main>
      </div>

      {searchLoaded && (
        <AdminSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      )}
    </div>
  );
}
