"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cn } from "@eins/ui";
import { TopProgressBar } from "./TopProgressBar";
import {
  LayoutDashboard,
  Inbox,
  Megaphone,
  Film,
  FileText,
  BookOpen,
  Milestone,
  Settings,
  MessageSquare,
  Star,
  Menu,
  Search,
} from "lucide-react";
import { CONTACT_CARD_COOKIE, type Role } from "@/lib/constants";
import { can } from "@/lib/roles";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { GlobalSearch } from "./GlobalSearch";

// Lazy-load the dialog so cmdk + the static index + icons don't ship on every
// authenticated route. Once loaded we keep it mounted so subsequent opens are
// instant.
const GlobalSearchDialog = dynamic(
  () => import("./GlobalSearchDialog").then((m) => m.GlobalSearchDialog),
  { ssr: false }
);
import { UserMenu } from "./UserMenu";
import { SidebarContactCard } from "./SidebarContactCard";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { EinsLogo } from "@/app/_components/EinsLogo";

interface NavSubItem {
  href: string;
  label: string;
  permission?: Parameters<typeof can>[1];
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Parameters<typeof can>[1];
  subItems?: NavSubItem[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Übersicht",
    items: [
      { href: "/dashboard", label: "Übersicht", icon: LayoutDashboard, permission: "dashboard.view" },
      { href: "/fortschritt", label: "Fortschritt", icon: Milestone },
    ],
  },
  {
    label: "Akquise",
    items: [
      { href: "/anfragen", label: "Anfragen", icon: Inbox, permission: "requests.view" },
      { href: "/werbebudget", label: "Werbebudget", icon: Megaphone, permission: "campaigns.live" },
    ],
  },
  {
    label: "Reputation",
    items: [
      {
        href: "/bewertungen",
        label: "Bewertungen",
        icon: Star,
        permission: "reviews.view",
        subItems: [
          { href: "/bewertungen", label: "Plattformen" },
          { href: "/bewertungen/feedback", label: "Patientenfeedback", permission: "patient_feedback.view" },
        ],
      },
    ],
  },
  {
    label: "Inhalte",
    items: [
      { href: "/medien", label: "Medien", icon: Film, permission: "assets.view" },
      { href: "/dokumente", label: "Dokumente", icon: FileText, permission: "documents.view.all_roles" },
      {
        href: "/leitfaden",
        label: "Leitfaden",
        icon: BookOpen,
        permission: "leitfaden.view",
        subItems: [
          { href: "/leitfaden", label: "Inhalt" },
          { href: "/leitfaden/pruefung", label: "Prüfung" },
        ],
      },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/feedback", label: "Feedback", icon: MessageSquare, permission: "feedback.submit" },
      { href: "/einstellungen", label: "Einstellungen", icon: Settings, permission: "settings.team" },
    ],
  },
];

/** Group label that should be visually anchored to the bottom of the sidenav. */
const BOTTOM_ANCHORED_GROUP = "System";

interface PortalShellProps {
  user: {
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    role: Role;
  };
  clinic: {
    id: string;
    displayName: string;
    logoUrl: string | null;
  };
  /** Set when an admin opened this session via "View as user". */
  impersonating: boolean;
  /** Per-nav-item pending indicators (small red dot on the icon). */
  pendingBadges?: { leitfaden?: boolean };
  /**
   * Per-nav-item accent badges, keyed by href. Rendered as a green accent
   * pill next to the label (desktop) / corner badge (mobile).
   *
   * Values:
   * - number > 0 → renders the count (e.g. "12", capped at "99+")
   * - non-empty string → renders that literal text (e.g. "Neu")
   * - 0 / "" / missing → no badge
   */
  navBadgeCounts?: Record<string, number | string>;
  /** Initial minimized state of the sidebar contact card, read from a cookie
   *  server-side so the first paint matches the user's last choice. */
  contactCardCollapsed?: boolean;
  children: ReactNode;
}

/**
 * Render contract for accent badges: numeric counts get the count + a cap,
 * string values pass through as-is. Empty/zero values return null so the
 * badge slot collapses.
 */
function badgeText(value: number | string | undefined, cap: number): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (value <= 0) return null;
  return value > cap ? `${cap}+` : String(value);
}

export function PortalShell({
  user,
  clinic,
  impersonating,
  pendingBadges,
  navBadgeCounts,
  contactCardCollapsed,
  children,
}: PortalShellProps) {
  const pathname = usePathname();

  // Sidebar contact card: minimized/expanded, persisted to a cookie so the
  // choice survives navigations and future sessions. State is lifted here (not
  // in the card) so the desktop rail and mobile drawer instances stay in sync.
  const [contactCollapsed, setContactCollapsed] = useState(!!contactCardCollapsed);
  const toggleContactCard = (next: boolean) => {
    setContactCollapsed(next);
    try {
      document.cookie = `${CONTACT_CARD_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // document unavailable (shouldn't happen client-side) — ignore.
    }
  };

  // Permission-filter both groups and sub-items, drop empty groups.
  const visibleGroups = useMemo<NavGroup[]>(
    () =>
      NAV_GROUPS.map((g) => ({
        label: g.label,
        items: g.items
          .filter((i) => !i.permission || can(user.role, i.permission))
          .map((i) => ({
            ...i,
            subItems: i.subItems?.filter(
              (s) => !s.permission || can(user.role, s.permission)
            ),
          })),
      })).filter((g) => g.items.length > 0),
    [user.role]
  );

  // Every navigable href in the sidebar, including sub-tabs, for active
  // detection and pill measurement.
  const allHrefs = useMemo<string[]>(() => {
    const out: string[] = [];
    for (const g of visibleGroups) {
      for (const i of g.items) {
        out.push(i.href);
        if (i.subItems) for (const s of i.subItems) out.push(s.href);
      }
    }
    return out;
  }, [visibleGroups]);

  // Most-specific match wins so /bewertungen/feedback beats /bewertungen.
  const activeHref = useMemo(() => {
    return allHrefs
      .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
      .sort((a, b) => b.length - a.length)[0];
  }, [allHrefs, pathname]);

  // Nav-click feedback. We optimistically set `pendingHref` when a side/mobile
  // nav link is clicked, then clear it once `pathname` matches the target
  // (i.e. the new RSC payload has actually rendered). This drives the top
  // progress bar so any cross-section navigation gets immediate visual
  // acknowledgement.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pendingHrefRef = useRef<string | null>(null);
  pendingHrefRef.current = pendingHref;

  // Mobile nav drawer: slide-out panel that hosts the same sidebar content
  // as the desktop rail. Opened via the header burger or a right-swipe from
  // the left edge; closed via tap-backdrop, swipe-left on the panel, Escape,
  // or any route change.
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

  // Desktop sidenav: same sliding-pill idea, but vertical and width-variable.
  // Items use `self-start` so each is sized to its own label, hence we track
  // top/left/width/height per active item rather than just left/width.
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

  // Safety net: if a navigation never resolves (e.g. user cancels), clear
  // the indicator after a generous timeout so it doesn't get stuck on screen.
  useEffect(() => {
    if (!pendingHref) return;
    const t = setTimeout(() => setPendingHref(null), 8000);
    return () => clearTimeout(t);
  }, [pendingHref]);

  // Close the mobile drawer whenever the route changes (i.e. after a tap on
  // any nav link inside it). Pathname-driven so it also closes on browser
  // back/forward.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open so the content beneath the
  // backdrop doesn't scroll under the finger.
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

  // Edge-swipe gestures: right-swipe from the left edge opens the drawer,
  // left-swipe (anywhere) closes it once open. Mobile only — we gate on a
  // matchMedia query so desktop pointer events don't trigger it. Thresholds
  // are tuned so a clearly horizontal gesture is required; vertical scrolls
  // and small wobbles are ignored.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const EDGE = 28; // px from left edge to start an open gesture
    const THRESHOLD = 60; // px of horizontal travel to commit
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      if (!mq.matches) return;
      const t = e.touches[0];
      if (!t) return;
      if (mobileNavOpen) {
        // When open, any touch on screen can start a left-swipe-to-close.
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
        return;
      }
      // When closed, only start if the touch began near the left edge.
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
      if (Math.abs(dx) <= dy) return; // dominated by vertical motion
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

  // Desktop sidenav: measure the active item and observe all items so the
  // pill follows font-load / role-change / hover-induced size shifts.
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

  const showProgress = pendingHref !== null;

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg-primary">
      <TopProgressBar active={showProgress} />
      {impersonating && (
        <ImpersonationBanner
          targetEmail={user.email}
          clinicName={clinic.displayName}
        />
      )}
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
            aria-controls="mobile-nav-drawer"
            className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-primary hover:bg-bg-secondary md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <Link href="/dashboard" className="flex items-center gap-3 md:pl-3">
            {clinic.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clinic.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
            ) : (
              <EinsLogo className="h-9 w-auto md:h-10" />
            )}
            <span aria-hidden="true" className="hidden h-7 w-px bg-border md:block" />
            <div className="hidden flex-col leading-tight md:flex">
              <span className="text-base font-semibold">{clinic.displayName || "EINS Portal"}</span>
            </div>
          </Link>

          <div className="flex-1" />

          <button
            type="button"
            onClick={openSearchPalette}
            aria-label="Suchen"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-primary hover:bg-bg-secondary md:hidden"
          >
            <Search className="h-5 w-5" />
          </button>

          <ThemeToggle />

          <UserMenu user={user} impersonating={impersonating} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-screen-2xl flex-1 gap-8 px-4 py-6 md:px-6">
        {/* Side rail (global search + nav). The wrapping <div> owns sticky
            positioning + overflow; the inner <nav> owns the pill-positioning
            context. Items use offsetTop relative to that inner <nav>, so the
            search bar above doesn't shift the math. */}
        <div className="sticky top-20 hidden h-[calc(100dvh-6rem)] w-56 shrink-0 flex-col gap-3 self-start overflow-y-auto pr-1 md:flex">
          <GlobalSearch onOpen={openSearchPalette} />
          <nav aria-label="Hauptnavigation" className="relative flex flex-1 flex-col gap-4">
          {/* Sliding active pill — slides vertically + resizes width/height to
              whichever sidenav item is active (parent or sub-tab). */}
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
          {visibleGroups.map((group) => {
            const isBottom = group.label === BOTTOM_ANCHORED_GROUP;
            return (
            <Fragment key={group.label}>
              {/* Contact card sits in the free space above the System group.
                  It carries `mt-auto` (rather than the group below it) so the
                  card + footer cluster at the bottom with no gap between
                  them. */}
              {isBottom && (
                <SidebarContactCard
                  className="mt-auto"
                  collapsed={contactCollapsed}
                  onToggle={toggleContactCard}
                />
              )}
            <div className="flex flex-col gap-0.5">
              <h3 className="px-3 pb-1 text-[0.7rem] font-medium text-fg-tertiary">
                {group.label}
              </h3>
              {group.items.map((item) => {
                const Icon = item.icon;
                const hasSubItems = (item.subItems?.length ?? 0) > 0;
                const sectionActive =
                  activeHref !== undefined &&
                  (item.href === activeHref ||
                    activeHref.startsWith(`${item.href}/`));
                // When a parent has sub-tabs, the pill belongs on the active
                // sub-tab — even when the sub-tab shares the parent's URL
                // (e.g. Bewertungen + its "Plattformen" sub-tab are both
                // /bewertungen). Without this, the parent would render as
                // white-on-transparent because the pill is sitting under the
                // sub-tab below it.
                const exactlyActive = !hasSubItems && item.href === activeHref;
                const showBadge =
                  item.href === "/leitfaden" && pendingBadges?.leitfaden === true;
                const badge = badgeText(navBadgeCounts?.[item.href], 99);
                const visibleSubItems = sectionActive ? item.subItems ?? [] : [];
                return (
                  <div key={item.href} className="flex flex-col gap-0.5">
                    <Link
                      ref={(el) => {
                        desktopItemRefs.current[item.href] = el;
                      }}
                      href={item.href}
                      // Full prefetch (page body + layout). All (portal) routes are
                      // dynamic — they read cookies via requireSession — so Next's
                      // default partial prefetch only fetches the loading skeleton,
                      // not the rendered page. That left every tab click waiting on
                      // the full server render TTFB. Forcing full prefetch warms the
                      // RSC payload while the sidenav is in viewport (i.e. always),
                      // making subsequent clicks feel instant. We skip the active
                      // tab to avoid prefetching the page we're already on.
                      prefetch={exactlyActive ? false : true}
                      onClick={exactlyActive ? undefined : () => setPendingHref(item.href)}
                      aria-current={exactlyActive ? "page" : undefined}
                      className={cn(
                        "relative z-10 flex items-center gap-3 rounded-xl px-3 py-1.5 text-base transition-colors duration-300",
                        exactlyActive
                          ? "font-semibold text-bg-primary"
                          : sectionActive
                            ? "font-semibold text-fg-primary"
                            : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
                        // SSR / pre-measurement fallback so the active label isn't
                        // briefly light-on-light before the pill mounts.
                        exactlyActive && !desktopPill && "bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                      )}
                    >
                      <span className="relative inline-flex shrink-0">
                        <Icon className="h-5 w-5" />
                        {showBadge && (
                          <span
                            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-bg-primary"
                            aria-label="Schulung ausstehend"
                          />
                        )}
                      </span>
                      <span>{item.label}</span>
                      {badge && (
                        <span
                          className={cn(
                            "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
                            exactlyActive
                              ? "bg-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                              : "bg-[var(--tone-good-bg)]"
                          )}
                          aria-label={
                            /^\d+(\+)?$/.test(badge) ? `${badge} neu` : badge
                          }
                        >
                          {badge}
                        </span>
                      )}
                    </Link>
                    {visibleSubItems.length > 0 && (
                      <div className="ml-[1.625rem] flex flex-col gap-0.5 border-l border-border pl-3">
                        {visibleSubItems.map((sub) => {
                          const subActive = sub.href === activeHref;
                          const subBadge = badgeText(navBadgeCounts?.[sub.href], 99);
                          return (
                            <Link
                              key={sub.href}
                              ref={(el) => {
                                desktopItemRefs.current[sub.href] = el;
                              }}
                              href={sub.href}
                              prefetch={subActive ? false : true}
                              onClick={subActive ? undefined : () => setPendingHref(sub.href)}
                              aria-current={subActive ? "page" : undefined}
                              className={cn(
                                "relative z-10 flex items-center gap-2 rounded-lg px-3 py-1 text-sm transition-colors duration-300",
                                subActive
                                  ? "font-semibold text-bg-primary"
                                  : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
                                subActive && !desktopPill && "bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                              )}
                            >
                              <span>{sub.label}</span>
                              {subBadge && (
                                <span
                                  className={cn(
                                    "ml-auto inline-flex min-w-[1.125rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-tone-good",
                                    subActive
                                      ? "bg-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                                      : "bg-[var(--tone-good-bg)]"
                                  )}
                                  aria-label={
                                    /^\d+(\+)?$/.test(subBadge)
                                      ? `${subBadge} neu`
                                      : subBadge
                                  }
                                >
                                  {subBadge}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </Fragment>
            );
          })}
          </nav>
        </div>

        {/* Mobile nav drawer — slide-out panel containing the same sidebar
            content as the desktop rail. Lives outside the desktop side rail
            and is hidden at md+. */}
        <div
          id="mobile-nav-drawer"
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
              {clinic.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={clinic.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <EinsLogo className="h-9 w-auto" />
              )}
              <span className="truncate text-base font-semibold">
                {clinic.displayName || "EINS Portal"}
              </span>
            </div>

            <GlobalSearch onOpen={openSearchPalette} />

            <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-4">
              {visibleGroups.map((group) => {
                const isBottom = group.label === BOTTOM_ANCHORED_GROUP;
                return (
                <Fragment key={group.label}>
                  {isBottom && (
                    <SidebarContactCard
                      className="mt-auto"
                      collapsed={contactCollapsed}
                      onToggle={toggleContactCard}
                    />
                  )}
                <div className="flex flex-col gap-0.5">
                  <h3 className="px-3 pb-1 text-[0.7rem] font-medium text-fg-tertiary">
                    {group.label}
                  </h3>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const hasSubItems = (item.subItems?.length ?? 0) > 0;
                    const sectionActive =
                      activeHref !== undefined &&
                      (item.href === activeHref ||
                        activeHref.startsWith(`${item.href}/`));
                    const exactlyActive = !hasSubItems && item.href === activeHref;
                    const showBadge =
                      item.href === "/leitfaden" && pendingBadges?.leitfaden === true;
                    const badge = badgeText(navBadgeCounts?.[item.href], 99);
                    const visibleSubItems = sectionActive ? item.subItems ?? [] : [];
                    return (
                      <div key={item.href} className="flex flex-col gap-0.5">
                        <Link
                          href={item.href}
                          prefetch={exactlyActive ? false : true}
                          onClick={
                            exactlyActive
                              ? () => setMobileNavOpen(false)
                              : () => setPendingHref(item.href)
                          }
                          aria-current={exactlyActive ? "page" : undefined}
                          className={cn(
                            "relative flex items-center gap-3 rounded-xl px-3 py-2 text-base transition-colors",
                            exactlyActive
                              ? "bg-fg-primary font-semibold text-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                              : sectionActive
                                ? "font-semibold text-fg-primary"
                                : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
                          )}
                        >
                          <span className="relative inline-flex shrink-0">
                            <Icon className="h-5 w-5" />
                            {showBadge && (
                              <span
                                className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-bg-primary"
                                aria-label="Schulung ausstehend"
                              />
                            )}
                          </span>
                          <span>{item.label}</span>
                          {badge && (
                            <span
                              className={cn(
                                "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
                                exactlyActive
                                  ? "bg-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                                  : "bg-[var(--tone-good-bg)]"
                              )}
                              aria-label={
                                /^\d+(\+)?$/.test(badge) ? `${badge} neu` : badge
                              }
                            >
                              {badge}
                            </span>
                          )}
                        </Link>
                        {visibleSubItems.length > 0 && (
                          <div className="ml-[1.625rem] flex flex-col gap-0.5 border-l border-border pl-3">
                            {visibleSubItems.map((sub) => {
                              const subActive = sub.href === activeHref;
                              const subBadge = badgeText(navBadgeCounts?.[sub.href], 99);
                              return (
                                <Link
                                  key={sub.href}
                                  href={sub.href}
                                  prefetch={subActive ? false : true}
                                  onClick={
                                    subActive
                                      ? () => setMobileNavOpen(false)
                                      : () => setPendingHref(sub.href)
                                  }
                                  aria-current={subActive ? "page" : undefined}
                                  className={cn(
                                    "relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                                    subActive
                                      ? "bg-fg-primary font-semibold text-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                                      : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
                                  )}
                                >
                                  <span>{sub.label}</span>
                                  {subBadge && (
                                    <span
                                      className={cn(
                                        "ml-auto inline-flex min-w-[1.125rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-tone-good",
                                        subActive
                                          ? "bg-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                                          : "bg-[var(--tone-good-bg)]"
                                      )}
                                      aria-label={
                                        /^\d+(\+)?$/.test(subBadge)
                                          ? `${subBadge} neu`
                                          : subBadge
                                      }
                                    >
                                      {subBadge}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </Fragment>
                );
              })}
            </nav>
          </aside>
        </div>

        {/* pb adds breathing room below the last row/card on scrollable pages.
            Because <main> is sized by flex-1 on short pages, the padding only
            becomes visible once content actually exceeds the viewport — pages
            with intrinsic whitespace (e.g. Dokumente when sparsely populated)
            stay unaffected. */}
        <main className="min-w-0 flex-1 pb-[max(5rem,env(safe-area-inset-bottom))]">{children}</main>
      </div>

      {searchLoaded && (
        <GlobalSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          userRole={user.role}
        />
      )}
    </div>
  );
}
