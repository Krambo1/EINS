"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@eins/ui";
import { TopProgressBar } from "./TopProgressBar";
import {
  LayoutDashboard,
  Inbox,
  Clapperboard,
  FileText,
  BookOpen,
  Milestone,
  Star,
  Menu,
  HelpCircle,
  Settings,
} from "lucide-react";
import type { Role } from "@/lib/constants";
import { can } from "@/lib/roles";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { UserMenu } from "./UserMenu";
import { markSectionSeenAction } from "./nav-actions";
import { EinsLogo } from "@/app/_components/EinsLogo";
import { useSwipeDrawer } from "@/app/_components/useSwipeDrawer";

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
  id: string;
  /** Visible group heading; null = no heading (main path, help). */
  label: string | null;
  items: NavItem[];
}

/**
 * Sidebar, main path first. Kept short on purpose (about ten entries): the
 * Werbebudget page is retired (2026-10-30; its figures are on the Übersicht,
 * the ad accounts in Einstellungen), "Einstellungen" is the last entry at the
 * foot, right above the account (and still in the account menu; Karam,
 * 2026-10-30), "Häufige Fragen" is the single "Hilfe" entry, Wiederbehandlungen
 * is the second view of Anfragen. Every page stays reachable by URL;
 * permissions are unchanged, except that every role now sees Einstellungen.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "haupt",
    label: null,
    items: [
      { href: "/dashboard", label: "Übersicht", icon: LayoutDashboard, permission: "dashboard.view" },
      { href: "/anfragen", label: "Anfragen", icon: Inbox, permission: "requests.view" },
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
      { href: "/fortschritt", label: "Fortschritt", icon: Milestone },
      // Medien and Beiträge are one page (2026-10-29).
      { href: "/inhalte", label: "Inhalte", icon: Clapperboard, permission: "assets.view" },
      // Dokumente and "Dateien an EINS" are one page (2026-10-29).
      { href: "/dateien", label: "Dateien", icon: FileText, permission: "documents.view.marketing" },
      { href: "/leitfaden", label: "Leitfaden", icon: BookOpen, permission: "leitfaden.view" },
    ],
  },
  {
    id: "hilfe",
    label: null,
    items: [
      { href: "/support", label: "Nachrichten an EINS", icon: Inbox, permission: "feedback.submit" },
      { href: "/faq", label: "Hilfe", icon: HelpCircle },
      // Every role: Profil and "Passwort ändern" live there. The page shows
      // each role only its own cards (Karam, 2026-10-30). Same as UserMenu.
      { href: "/einstellungen", label: "Einstellungen", icon: Settings },
    ],
  },
];

/** Group that is visually anchored to the bottom of the sidenav. */
const BOTTOM_ANCHORED_GROUP = "hilfe";

/** Pages without a nav entry of their own, and the entry that stays marked. */
const NAV_ALIASES: Record<string, string> = {
  "/wiederbehandlungen": "/anfragen",
};

/**
 * Logo and Praxis name at the top of the sidebar: the brand, a link to the
 * Übersicht, not a menu. A long name takes two lines, never cut.
 */
function BrandMark({
  href,
  logoUrl,
  name,
  className,
}: {
  href: string;
  logoUrl: string | null;
  name: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2.5 rounded-[var(--r-control)] pl-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-[var(--r-small)] object-cover" />
      ) : (
        <EinsLogo className="h-7 w-auto shrink-0" />
      )}
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
      <span className="line-clamp-2 min-w-0 break-words text-[15px] font-semibold leading-5 text-fg-primary">
        {name}
      </span>
    </Link>
  );
}

/**
 * The one marker right of a nav label, on every row (main entry, sub-entry,
 * phone drawer and header, active or not): a box in a light tint with text
 * in the same tone. Green = something new ("12", "Neu"), amber = something
 * the user still owes ("1 fällig"). Same size, radius and type for both.
 */
function NavMarker({
  text,
  tone,
  label,
  title,
}: {
  text: string;
  tone: "new" | "due";
  label: string;
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--r-small)] border px-1.5 text-xs font-semibold leading-none tabular-nums",
        // The text is the tone darkened (about 7:1 on the tint): the plain
        // tone colours are 2.6 to 3:1 on white, too faint at 12 px.
        tone === "new"
          ? "border-[var(--tone-good-border)] bg-[color-mix(in_srgb,var(--tone-good)_14%,white)] text-[color-mix(in_srgb,var(--tone-good)_55%,black)]"
          : "border-[var(--tone-warn-border)] bg-[color-mix(in_srgb,var(--tone-warn)_16%,white)] text-[color-mix(in_srgb,var(--tone-warn)_50%,black)]"
      )}
      aria-label={label}
      title={title}
    >
      {text}
    </span>
  );
}

/** Markers of one nav entry: its "neu" count or "Neu", then due Wiedervorlagen. */
function NavMarkers({ badge, due }: { badge: string | null; due: number }) {
  if (!badge && due <= 0) return null;
  const n = due > 99 ? "99+" : String(due);
  return (
    <span className="ml-auto flex items-center gap-1">
      {badge && (
        <NavMarker
          text={badge}
          tone="new"
          label={/^\d+(\+)?$/.test(badge) ? `${badge} neu` : badge}
        />
      )}
      {due > 0 && (
        <NavMarker
          text={`${n} fällig`}
          tone="due"
          label={`${n} Wiedervorlagen fällig`}
          title="Wiedervorlagen, die heute oder früher fällig sind"
        />
      )}
    </span>
  );
}

export interface PortalShellProps {
  user: {
    email: string;
    fullName: string | null;
    role: Role;
  };
  clinic: {
    id: string;
    displayName: string;
    logoUrl: string | null;
  };
  /** Set when an admin opened this session via "View as user". */
  impersonating: boolean;
  /** ISO end of the impersonation session (hard 30 min), for the banner. */
  impersonationExpiresAt?: string | null;
  /**
   * Per-nav-item "new" markers, keyed by href. Rendered as a green box right
   * of the label (`NavMarker`).
   *
   * Values:
   * - number > 0 → renders the count (e.g. "12", capped at "99+")
   * - non-empty string → renders that literal text (e.g. "Neu")
   * - 0 / "" / missing → no badge
   */
  navBadgeCounts?: Record<string, number | string>;
  /** Due Wiedervorlagen, shown as their own pill next to "Anfragen". */
  anfragenDue?: number;
  /**
   * A notice above both columns (the Start-Checkliste reminder). Above them,
   * not inside the page, so the logo and the nav still line up with the
   * page's first row and first card.
   */
  notice?: ReactNode;
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

export function PortalShellClient({
  user,
  clinic,
  impersonating,
  impersonationExpiresAt,
  navBadgeCounts: serverBadgeCounts,
  anfragenDue = 0,
  notice,
  children,
}: PortalShellProps) {
  const pathname = usePathname();
  const clinicName = clinic.displayName || "EINS Portal";

  // "Neu" pills of sections the user opened by a click in the portal. The
  // layout (and its badge counts) does not render again on such a soft
  // navigation, so the server-side stamp never runs; we stamp via a server
  // action and hide the pill locally until the next full render.
  const [seenSections, setSeenSections] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  useEffect(() => {
    const first = pathname?.split("/").filter(Boolean)[0];
    // The documents' "Neu" belongs to the Dateien page, the Medien's to Inhalte.
    const section = first === "dateien" ? "dokumente" : first === "inhalte" ? "medien" : first;
    if (!first || !section || !["fortschritt", "medien", "dokumente"].includes(section)) return;
    const href = `/${first}`;
    if (serverBadgeCounts?.[href] !== "Neu" || seenSections.has(href)) return;
    setSeenSections((prev) => new Set(prev).add(href));
    void markSectionSeenAction(section).catch(() => {});
  }, [pathname, serverBadgeCounts, seenSections]);
  const navBadgeCounts = useMemo(() => {
    if (!serverBadgeCounts || seenSections.size === 0) return serverBadgeCounts;
    const out = { ...serverBadgeCounts };
    for (const href of seenSections) out[href] = 0;
    return out;
  }, [serverBadgeCounts, seenSections]);

  // Permission-filter both groups and sub-items, drop empty groups.
  const visibleGroups = useMemo<NavGroup[]>(
    () =>
      NAV_GROUPS.map((g) => ({
        id: g.id,
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
  // A page without its own entry marks the entry it belongs to.
  const activeHref = useMemo(() => {
    const alias = Object.keys(NAV_ALIASES).find(
      (a) => pathname === a || pathname.startsWith(`${a}/`)
    );
    const path = alias ? NAV_ALIASES[alias]! : pathname;
    return allHrefs
      .filter((h) => path === h || path.startsWith(`${h}/`))
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
  // as the desktop rail. Opened via the header burger; closed via
  // tap-backdrop, Escape, or any route change.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  // A swipe to the right opens the drawer, to the left closes it (phone).
  useSwipeDrawer(mobileNavOpen, setMobileNavOpen);

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

  // A notice above both columns pushes the sticky sidebar down until the page
  // scrolls. The sidebar leaves its height out (--shell-notice), so "Hilfe"
  // at its foot stays on the first screen. 5.5rem is the one-line banner at
  // desktop width with its gap below, so the first paint is already right.
  const noticeRef = useRef<HTMLDivElement>(null);
  const [noticeHeight, setNoticeHeight] = useState<number | null>(null);
  const hasNotice = notice != null && notice !== false;
  useEffect(() => {
    const el = noticeRef.current;
    if (!el) return;
    const measure = () => setNoticeHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNotice]);
  const shellStyle = {
    "--shell-notice": hasNotice ? (noticeHeight != null ? `${noticeHeight}px` : "5.5rem") : "0px",
  } as CSSProperties;

  const showProgress = pendingHref !== null;

  // Top-bar shortcut to Anfragen on the phone (same permission as the nav).
  const anfragenHeader = can(user.role, "requests.view")
    ? (() => {
        const newText = badgeText(navBadgeCounts?.["/anfragen"], 99);
        const due = anfragenDue > 0;
        const parts = [
          newText ? `${newText} neu` : null,
          due ? `${anfragenDue > 99 ? "99+" : anfragenDue} fällig` : null,
        ].filter(Boolean);
        return {
          newText,
          due,
          label: parts.length > 0 ? `Anfragen: ${parts.join(", ")}` : "Anfragen",
        };
      })()
    : null;

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-[var(--surface-canvas)]">
      <TopProgressBar active={showProgress} />
      {impersonating && (
        <ImpersonationBanner
          targetEmail={user.email}
          clinicName={clinic.displayName}
          expiresAt={impersonationExpiresAt ?? null}
        />
      )}
      {/* Phone header: frosted canvas, so cards scrolling under it stay
          faintly visible and the header reads as the top layer. From md there
          is no header bar: the account menu heads the sidebar, on the page's
          first row. On the phone it heads the drawer the same way. */}
      <header
        className="sticky top-0 z-40 border-b border-border backdrop-blur-md md:hidden"
        style={{ backgroundColor: "color-mix(in srgb, var(--surface-canvas) 82%, transparent)" }}
      >
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-1.5 px-4 md:h-16 md:gap-4 md:px-6">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Menü öffnen"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav-drawer"
            className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-[var(--r-control)] text-fg-primary hover:bg-bg-secondary md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <Link href="/dashboard" className="flex items-center gap-3 md:pl-3">
            {clinic.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clinic.logoUrl} alt="" className="h-9 w-9 rounded-[var(--r-control)] object-cover" />
            ) : (
              <EinsLogo className="h-8 w-auto md:h-9" />
            )}
            <span aria-hidden="true" className="hidden h-7 w-px bg-border md:block" />
            <div className="hidden flex-col leading-tight md:flex">
              <span className="text-base font-semibold">{clinic.displayName || "EINS Portal"}</span>
            </div>
          </Link>

          <div className="flex-1" />

          {/* Phone: Anfragen one tap away, with the same markers as the
              sidebar entry. */}
          {anfragenHeader && (
            <Link
              href="/anfragen"
              onClick={
                activeHref === "/anfragen" ? undefined : () => setPendingHref("/anfragen")
              }
              aria-label={anfragenHeader.label}
              aria-current={activeHref === "/anfragen" ? "page" : undefined}
              className={cn(
                "inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-[var(--r-control)] px-2.5 text-fg-primary hover:bg-bg-secondary md:hidden",
                activeHref === "/anfragen" && "bg-bg-secondary"
              )}
            >
              <Inbox className="h-5 w-5 shrink-0" aria-hidden />
              <span aria-hidden className="contents">
                <NavMarkers badge={anfragenHeader.newText} due={anfragenDue} />
              </span>
            </Link>
          )}
        </div>
      </header>

      <div
        className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col px-4 py-4 md:px-6 md:py-8"
        style={shellStyle}
      >
      {hasNotice && <div ref={noticeRef}>{notice}</div>}
      <div className="flex flex-1 gap-8 lg:gap-12">
        {/* Side rail (nav). The wrapping <div> owns sticky positioning +
            overflow. Its rows line up with the page beside it: the logo row
            is as tall as the page's first row (--shell-row, the period
            switch on the Übersicht), and the nav starts one spacing step
            (24 px) below it, level with the first card. The account is at
            the foot, under Hilfe. */}
        <div className="sticky top-8 hidden h-[calc(100dvh-4rem-var(--shell-notice))] w-56 shrink-0 flex-col gap-3 self-start overflow-y-auto pr-1 md:flex lg:w-60">
          <BrandMark href="/dashboard" logoUrl={clinic.logoUrl} name={clinicName} className="mb-3 h-[var(--shell-row)]" />
          <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-4">
          {visibleGroups.map((group) => {
            const isBottom = group.id === BOTTOM_ANCHORED_GROUP;
            return (
            <Fragment key={group.id}>
            {/* The "Hilfe" group sits at the bottom of the column. */}
            <div className={cn("flex flex-col gap-0.5", isBottom && "mt-auto")}>
              {group.label && (
                <h3 className="px-3 pb-1 text-[13px] font-medium text-fg-secondary">
                  {group.label}
                </h3>
              )}
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
                // /bewertungen).
                const exactlyActive = !hasSubItems && item.href === activeHref;
                const badge = badgeText(navBadgeCounts?.[item.href], 99);
                const visibleSubItems = sectionActive ? item.subItems ?? [] : [];
                return (
                  <div key={item.href} className="flex flex-col gap-0.5">
                    <Link
                      href={item.href}
                      // Default prefetch (loading skeleton only), not a full
                      // render: the desktop rail is always in view, so a full
                      // prefetch rendered every portal page in the background
                      // on every page view (10+ server renders, dozens of DB
                      // transactions). loading.tsx + TopProgressBar cover the
                      // click. No prefetch for the page we're on.
                      prefetch={exactlyActive ? false : undefined}
                      onClick={exactlyActive ? undefined : () => setPendingHref(item.href)}
                      aria-current={exactlyActive ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 rounded-[var(--r-control)] px-3 py-1.5 text-[15px] transition-colors duration-150",
                        // The page you are on is raised off the canvas like a card.
                        exactlyActive
                          ? "elev-raised bg-[var(--surface-raised)] font-semibold text-fg-primary"
                          : sectionActive
                            ? "font-semibold text-fg-primary"
                            : "font-medium text-fg-secondary hover:bg-[var(--hover-wash)] hover:text-fg-primary"
                      )}
                    >
                      <span className="relative inline-flex shrink-0">
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span>{item.label}</span>
                      <NavMarkers
                        badge={badge}
                        due={item.href === "/anfragen" ? anfragenDue : 0}
                      />
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
                              prefetch={subActive ? false : undefined}
                              onClick={subActive ? undefined : () => setPendingHref(sub.href)}
                              aria-current={subActive ? "page" : undefined}
                              className={cn(
                                "relative flex items-center gap-2 rounded-[var(--r-small)] px-3 py-1 text-sm transition-colors duration-150",
                                subActive
                                  ? "elev-raised bg-[var(--surface-raised)] font-semibold text-fg-primary"
                                  : "font-medium text-fg-secondary hover:bg-[var(--hover-wash)] hover:text-fg-primary"
                              )}
                            >
                              <span>{sub.label}</span>
                              <NavMarkers badge={subBadge} due={0} />
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
          <div className="shrink-0 border-t border-border pt-3">
            <UserMenu user={user} clinicName={clinicName} />
          </div>
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
            <BrandMark href="/dashboard" logoUrl={clinic.logoUrl} name={clinicName} className="h-11 pb-1" />

            <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-4">
              {visibleGroups.map((group) => {
                const isBottom = group.id === BOTTOM_ANCHORED_GROUP;
                return (
                <Fragment key={group.id}>
                <div className={cn("flex flex-col gap-0.5", isBottom && "mt-auto")}>
                  {group.label && (
                    <h3 className="px-3 pb-1 text-[13px] font-medium text-fg-secondary">
                      {group.label}
                    </h3>
                  )}
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const hasSubItems = (item.subItems?.length ?? 0) > 0;
                    const sectionActive =
                      activeHref !== undefined &&
                      (item.href === activeHref ||
                        activeHref.startsWith(`${item.href}/`));
                    const exactlyActive = !hasSubItems && item.href === activeHref;
                    const badge = badgeText(navBadgeCounts?.[item.href], 99);
                    const visibleSubItems = sectionActive ? item.subItems ?? [] : [];
                    return (
                      <div key={item.href} className="flex flex-col gap-0.5">
                        <Link
                          href={item.href}
                          prefetch={exactlyActive ? false : undefined}
                          onClick={
                            exactlyActive
                              ? () => setMobileNavOpen(false)
                              : () => setPendingHref(item.href)
                          }
                          aria-current={exactlyActive ? "page" : undefined}
                          className={cn(
                            "relative flex items-center gap-3 rounded-[var(--r-control)] px-3 py-2 text-base transition-colors",
                            exactlyActive
                              ? "bg-bg-secondary font-semibold text-fg-primary"
                              : sectionActive
                                ? "font-semibold text-fg-primary"
                                : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
                          )}
                        >
                          <span className="relative inline-flex shrink-0">
                            <Icon className="h-5 w-5" />
                          </span>
                          <span>{item.label}</span>
                          <NavMarkers
                            badge={badge}
                            due={item.href === "/anfragen" ? anfragenDue : 0}
                          />
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
                                  prefetch={subActive ? false : undefined}
                                  onClick={
                                    subActive
                                      ? () => setMobileNavOpen(false)
                                      : () => setPendingHref(sub.href)
                                  }
                                  aria-current={subActive ? "page" : undefined}
                                  className={cn(
                                    "relative flex items-center gap-2 rounded-[var(--r-small)] px-3 py-1.5 text-sm transition-colors",
                                    subActive
                                      ? "bg-bg-secondary font-semibold text-fg-primary"
                                      : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
                                  )}
                                >
                                  <span>{sub.label}</span>
                                  <NavMarkers badge={subBadge} due={0} />
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
            <div className="shrink-0 border-t border-border pt-3">
              <UserMenu user={user} clinicName={clinicName} />
            </div>
          </aside>
        </div>

        {/* pb adds breathing room below the last row/card on scrollable pages.
            Because <main> is sized by flex-1 on short pages, the padding only
            becomes visible once content actually exceeds the viewport — pages
            with intrinsic whitespace (e.g. Dokumente when sparsely populated)
            stay unaffected. */}
        <main className="min-w-0 flex-1 pb-[max(5rem,env(safe-area-inset-bottom))]">
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}
