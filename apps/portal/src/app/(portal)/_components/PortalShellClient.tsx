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
  Clapperboard,
  FileText,
  BookOpen,
  Milestone,
  Star,
  Menu,
  Search,
  HelpCircle,
  FileUp,
  CalendarClock,
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
import { markSectionSeenAction } from "./nav-actions";
import { SidebarContactCard } from "./SidebarContactCard";
import { TourNavCard } from "./tour/TourNavCard";
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
  /** Only listed once the Praxis runs ads (organic start hides it). */
  needsAdData?: boolean;
}

interface NavGroup {
  id: string;
  /** Visible group heading; null = no heading (main path, help). */
  label: string | null;
  items: NavItem[];
}

/**
 * Sidebar, main path first. Kept short on purpose (about ten entries for a
 * new Praxis): "Werbebudget" appears once ads run, "Einstellungen" and
 * "Feedback senden" live in the account menu (top right), "Häufige Fragen" is
 * the single "Hilfe" entry. Every page stays reachable by URL and by the
 * search (Strg+K); permissions are unchanged.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "haupt",
    label: null,
    items: [
      { href: "/dashboard", label: "Übersicht", icon: LayoutDashboard, permission: "dashboard.view" },
      { href: "/anfragen", label: "Anfragen", icon: Inbox, permission: "requests.view" },
      { href: "/wiederbehandlungen", label: "Wiederbehandlungen", icon: CalendarClock, permission: "requests.view" },
      { href: "/werbebudget", label: "Werbebudget", icon: Megaphone, permission: "campaigns.live", needsAdData: true },
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
    id: "eins",
    label: "Zusammenarbeit mit EINS",
    items: [
      { href: "/fortschritt", label: "Fortschritt", icon: Milestone },
      { href: "/medien", label: "Medien", icon: Film, permission: "assets.view" },
      { href: "/beitraege", label: "Beiträge", icon: Clapperboard, permission: "assets.view" },
      { href: "/dokumente", label: "Dokumente", icon: FileText, permission: "documents.view.all_roles" },
      { href: "/dateien", label: "Dateien an EINS", icon: FileUp, permission: "uploads.send" },
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
    id: "hilfe",
    label: null,
    items: [
      { href: "/support", label: "Nachrichten an EINS", icon: Inbox, permission: "feedback.submit" },
      { href: "/faq", label: "Hilfe", icon: HelpCircle },
    ],
  },
];

/** Group that is visually anchored to the bottom of the sidenav. */
const BOTTOM_ANCHORED_GROUP = "hilfe";

/**
 * Pill for something the user still owes, right of the nav label: due
 * Wiedervorlagen next to "Anfragen", the open Prüfung next to "Leitfaden".
 * Dark text on a light amber tint with an amber dot, so it reads apart from
 * the green "neu" count without putting text on a strong colour fill. Every
 * nav marker sits on the right, none on the icon.
 */
function ActionPill({
  text,
  label,
  title,
  active,
}: {
  text: string;
  label: string;
  title: string;
  active: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums text-fg-primary",
        active
          ? "border-transparent bg-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
          : "border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)]"
      )}
      aria-label={label}
      title={title}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-tone-warn" />
      {text}
    </span>
  );
}

function DuePill({ count, active }: { count: number; active: boolean }) {
  if (count <= 0) return null;
  const n = count > 99 ? "99+" : String(count);
  return (
    <ActionPill
      text={`${n} fällig`}
      label={`${n} Wiedervorlagen fällig`}
      title="Wiedervorlagen, die heute oder früher fällig sind"
      active={active}
    />
  );
}

function LeitfadenPill({ active }: { active: boolean }) {
  return (
    <ActionPill
      text="offen"
      label="Schulung ausstehend"
      title="Die Leitfaden-Prüfung ist noch nicht bestanden"
      active={active}
    />
  );
}

export interface PortalShellProps {
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
  /** ISO end of the impersonation session (hard 30 min), for the banner. */
  impersonationExpiresAt?: string | null;
  /** Per-nav-item pending indicators (amber "offen" pill right of the label). */
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
  /** Due Wiedervorlagen, shown as their own pill next to "Anfragen". */
  anfragenDue?: number;
  /** Ad account connected or campaign data present: list "Werbebudget". */
  showWerbebudget?: boolean;
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

export function PortalShellClient({
  user,
  clinic,
  impersonating,
  impersonationExpiresAt,
  pendingBadges,
  navBadgeCounts: serverBadgeCounts,
  anfragenDue = 0,
  showWerbebudget = false,
  contactCardCollapsed,
  children,
}: PortalShellProps) {
  const pathname = usePathname();

  // "Neu" pills of sections the user opened by a click in the portal. The
  // layout (and its badge counts) does not render again on such a soft
  // navigation, so the server-side stamp never runs; we stamp via a server
  // action and hide the pill locally until the next full render.
  const [seenSections, setSeenSections] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  useEffect(() => {
    const first = pathname?.split("/").filter(Boolean)[0];
    if (!first || !["fortschritt", "medien", "dokumente"].includes(first)) return;
    const href = `/${first}`;
    if (serverBadgeCounts?.[href] !== "Neu" || seenSections.has(href)) return;
    setSeenSections((prev) => new Set(prev).add(href));
    void markSectionSeenAction(first).catch(() => {});
  }, [pathname, serverBadgeCounts, seenSections]);
  const navBadgeCounts = useMemo(() => {
    if (!serverBadgeCounts || seenSections.size === 0) return serverBadgeCounts;
    const out = { ...serverBadgeCounts };
    for (const href of seenSections) out[href] = 0;
    return out;
  }, [serverBadgeCounts, seenSections]);

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

  // "Werbebudget" stays listed while the user is on it (tour step, search).
  const onWerbebudget =
    pathname === "/werbebudget" || pathname.startsWith("/werbebudget/");
  const adsVisible = showWerbebudget || onWerbebudget;

  // Permission-filter both groups and sub-items, drop empty groups.
  const visibleGroups = useMemo<NavGroup[]>(
    () =>
      NAV_GROUPS.map((g) => ({
        id: g.id,
        label: g.label,
        items: g.items
          .filter((i) => !i.permission || can(user.role, i.permission))
          .filter((i) => !i.needsAdData || adsVisible)
          .map((i) => ({
            ...i,
            subItems: i.subItems?.filter(
              (s) => !s.permission || can(user.role, s.permission)
            ),
          })),
      })).filter((g) => g.items.length > 0),
    [user.role, adsVisible]
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
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg-primary">
      <TopProgressBar active={showProgress} />
      {impersonating && (
        <ImpersonationBanner
          targetEmail={user.email}
          clinicName={clinic.displayName}
          expiresAt={impersonationExpiresAt ?? null}
        />
      )}
      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b border-border backdrop-blur"
        style={{ backgroundColor: "color-mix(in srgb, var(--bg-primary) 95%, transparent)" }}
      >
        <div className="mx-auto flex max-w-screen-2xl items-center gap-1.5 px-4 py-3 md:gap-4 md:px-6">
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

          {/* Phone: Anfragen one tap away, with the same counts as the
              sidebar (new = dark count, due Wiedervorlagen = amber dot). */}
          {anfragenHeader && (
            <Link
              href="/anfragen"
              onClick={
                activeHref === "/anfragen" ? undefined : () => setPendingHref("/anfragen")
              }
              aria-label={anfragenHeader.label}
              aria-current={activeHref === "/anfragen" ? "page" : undefined}
              className={cn(
                "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-fg-primary hover:bg-bg-secondary md:hidden",
                activeHref === "/anfragen" && "bg-bg-secondary"
              )}
            >
              <Inbox className="h-5 w-5" aria-hidden />
              {anfragenHeader.newText && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-fg-primary px-1 text-xs font-semibold tabular-nums text-bg-primary ring-2 ring-bg-primary"
                >
                  {anfragenHeader.newText}
                </span>
              )}
              {anfragenHeader.due && (
                <span
                  aria-hidden
                  className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full bg-tone-warn ring-2 ring-bg-primary"
                />
              )}
            </Link>
          )}

          <button
            type="button"
            onClick={openSearchPalette}
            aria-label="Suchen"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-primary hover:bg-bg-secondary md:hidden"
          >
            <Search className="h-5 w-5" />
          </button>

          {/* Phone: the theme switch moves into the drawer to make room. */}
          <div className="hidden md:block">
            <ThemeToggle />
          </div>

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
            const isBottom = group.id === BOTTOM_ANCHORED_GROUP;
            return (
            <Fragment key={group.id}>
              {/* Contact card sits in the free space above the "Hilfe" entry.
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
              {/* Tour re-entry card sits directly above the help group
                  ("Hilfe"), below everything else. */}
              {isBottom && <TourNavCard />}
            <div className="flex flex-col gap-0.5">
              {group.label && (
                <h3 className="px-3 pb-1 text-sm font-medium text-fg-primary">
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
                      </span>
                      <span>{item.label}</span>
                      {(badge || showBadge || (item.href === "/anfragen" && anfragenDue > 0)) && (
                        <span className="ml-auto flex items-center gap-1">
                          {badge && (
                            <span
                              className={cn(
                                "inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
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
                          {item.href === "/anfragen" && (
                            <DuePill count={anfragenDue} active={exactlyActive} />
                          )}
                          {showBadge && <LeitfadenPill active={exactlyActive} />}
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
                              prefetch={subActive ? false : undefined}
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
                                    "ml-auto inline-flex min-w-[1.125rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
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
                const isBottom = group.id === BOTTOM_ANCHORED_GROUP;
                return (
                <Fragment key={group.id}>
                  {isBottom && (
                    <SidebarContactCard
                      className="mt-auto"
                      collapsed={contactCollapsed}
                      onToggle={toggleContactCard}
                    />
                  )}
                  {isBottom && <TourNavCard />}
                <div className="flex flex-col gap-0.5">
                  {group.label && (
                    <h3 className="px-3 pb-1 text-sm font-medium text-fg-primary">
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
                    const showBadge =
                      item.href === "/leitfaden" && pendingBadges?.leitfaden === true;
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
                          </span>
                          <span>{item.label}</span>
                          {(badge || showBadge || (item.href === "/anfragen" && anfragenDue > 0)) && (
                            <span className="ml-auto flex items-center gap-1">
                              {badge && (
                                <span
                                  className={cn(
                                    "inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
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
                              {item.href === "/anfragen" && (
                                <DuePill count={anfragenDue} active={exactlyActive} />
                              )}
                              {showBadge && <LeitfadenPill active={exactlyActive} />}
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
                                  prefetch={subActive ? false : undefined}
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
                                        "ml-auto inline-flex min-w-[1.125rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums text-tone-good",
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

            <div className="flex items-center justify-between gap-3 border-t border-border px-3 pt-3">
              <span className="text-sm font-medium text-fg-primary">Helles oder dunkles Design</span>
              <ThemeToggle />
            </div>
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
          clinicId={clinic.id}
          userEmail={user.email}
        />
      )}
    </div>
  );
}
