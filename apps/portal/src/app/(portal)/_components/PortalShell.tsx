"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { DetailToggle, type UiMode, cn } from "@eins/ui";
import { TopProgressBar } from "./TopProgressBar";
import {
  LayoutDashboard,
  Inbox,
  BarChart3,
  Megaphone,
  Film,
  FileText,
  BookOpen,
  Milestone,
  Settings,
  Calculator,
  MessageSquare,
  Star,
  LogOut,
} from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { can } from "@/lib/roles";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { DetailIntroToast } from "./DetailIntroToast";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { EinsLogo } from "@/app/_components/EinsLogo";

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
  { href: "/fortschritt", label: "Fortschritt", icon: Milestone },
  { href: "/medien", label: "Medien", icon: Film, permission: "assets.view" },
  { href: "/bewertungen", label: "Bewertungen", icon: Star, permission: "reviews.view" },
  { href: "/dokumente", label: "Dokumente", icon: FileText, permission: "documents.view.all_roles" },
  { href: "/leitfaden", label: "Leitfaden", icon: BookOpen, permission: "documents.view.marketing" },
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

  const activeHref = visibleNav.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  )?.href;

  // Einfach / Detail toggle wiring.
  //
  // We keep two layers of state on top of the server-loaded `user.uiMode`:
  //
  //   1. `localMode` (plain useState) — survives across the whole click→
  //      fetch→router.refresh round-trip and is rebased from `user.uiMode`
  //      via useEffect once the refresh settles. This is what actually
  //      drives the UI; without it, the toggle is fully controlled by
  //      server state and stays frozen for ~500–1500 ms per click, which
  //      reads as "the button is broken."
  //
  //   2. `useOptimistic` would also work, but only INSIDE the transition;
  //      a failed fetch + delayed refresh combo can momentarily snap back
  //      before `user.uiMode` updates, causing a flicker. Plain state +
  //      explicit rebase is more predictable here.
  //
  // The fetch + router.refresh still runs in a transition so React doesn't
  // block paint while the (portal) layout re-renders.
  const [localMode, setLocalMode] = useState<UiMode>(user.uiMode);
  const [isModePending, startTransition] = useTransition();

  // Nav-click feedback. We optimistically set `pendingHref` when a side/mobile
  // nav link is clicked, then clear it once `pathname` matches the target
  // (i.e. the new RSC payload has actually rendered). This drives the same
  // top progress bar as the Einfach/Detail toggle so any cross-section
  // navigation gets immediate visual acknowledgement.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pendingHrefRef = useRef<string | null>(null);
  pendingHrefRef.current = pendingHref;

  // Mobile bottom-nav: sliding active pill + auto-center the active tab.
  // We render a single absolutely positioned pill behind the tabs and
  // animate its transform/width to the active tab's measured box, instead
  // of toggling a per-tab background (which "teleports"). On every active
  // change we also scroll the active tab to the horizontal center of the
  // nav — instant on first mount, smooth on subsequent navigations.
  const mobileNavRef = useRef<HTMLElement | null>(null);
  const mobileItemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [mobilePill, setMobilePill] = useState<{ left: number; width: number } | null>(null);
  const hasInitiallyCenteredRef = useRef(false);

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

  // When the server-loaded mode catches up (post router.refresh, or another
  // tab changed it), rebase. If the fetch failed, this snaps localMode back
  // to truth.
  useEffect(() => {
    setLocalMode(user.uiMode);
  }, [user.uiMode]);

  // Measure the active mobile-nav tab and snap the sliding pill + horizontal
  // scroll to it. Runs whenever the active route changes. First run after
  // mount uses instant scroll so we don't animate on initial page load; later
  // runs use smooth scroll so tapping a tab visibly slides it into center.
  useEffect(() => {
    if (!activeHref) return;
    const itemEl = mobileItemRefs.current[activeHref];
    const navEl = mobileNavRef.current;
    if (!itemEl || !navEl) return;

    setMobilePill({ left: itemEl.offsetLeft, width: itemEl.offsetWidth });

    const center = itemEl.offsetLeft + itemEl.offsetWidth / 2;
    const target = center - navEl.clientWidth / 2;
    navEl.scrollTo({
      left: target,
      behavior: hasInitiallyCenteredRef.current ? "smooth" : "auto",
    });
    hasInitiallyCenteredRef.current = true;
  }, [activeHref]);

  // Recompute pill position on viewport resize (e.g. rotation) — offsets
  // can shift when nav width changes.
  useEffect(() => {
    if (!activeHref) return;
    const onResize = () => {
      const itemEl = mobileItemRefs.current[activeHref];
      if (!itemEl) return;
      setMobilePill({ left: itemEl.offsetLeft, width: itemEl.offsetWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeHref]);

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

  const onModeChange = (mode: UiMode) => {
    // Loud diagnostic so we can tell from the browser console whether the
    // click is reaching React at all. Cheap to leave in for now; remove
    // once the Turbopack flake is fully understood.
    console.info("[ui-mode] click", { from: localMode, to: mode });
    if (mode === localMode) return;
    setLocalMode(mode); // instant visual flip
    startTransition(async () => {
      try {
        console.info("[ui-mode] PATCH /api/me/ui-mode →", mode);
        const res = await fetch("/api/me/ui-mode", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
          credentials: "same-origin",
        });
        console.info("[ui-mode] PATCH response", res.status);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn("[ui-mode] PATCH failed", res.status, text);
          setLocalMode(user.uiMode); // revert
          return;
        }
        router.refresh();
      } catch (err) {
        console.error("[ui-mode] PATCH threw", err);
        setLocalMode(user.uiMode);
      }
    });
  };

  const showProgress = isModePending || pendingHref !== null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg-primary">
      <TopProgressBar active={showProgress} />
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
              <EinsLogo className="h-9 w-auto md:h-10" />
            )}
            <span aria-hidden="true" className="hidden h-7 w-px bg-border md:block" />
            <div className="hidden flex-col leading-tight md:flex">
              <span className="text-base font-semibold">{clinic.displayName || "EINS Portal"}</span>
            </div>
          </Link>

          <div className="flex-1" />

          <div
            className={cn(
              "transition-opacity",
              isModePending ? "opacity-60" : "opacity-100"
            )}
            aria-busy={isModePending || undefined}
          >
            <DetailToggle value={localMode} onChange={onModeChange} />
          </div>

          <ThemeToggle />

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
          {/* Sliding active pill — slides vertically + resizes width to match
              whichever sidenav item is active. */}
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
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
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
                prefetch={active ? false : true}
                onClick={active ? undefined : () => setPendingHref(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative z-10 flex min-h-[48px] items-center gap-3 self-start rounded-xl px-3 py-2 pr-5 text-base transition-colors duration-300",
                  active
                    ? "font-semibold text-bg-primary"
                    : "font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
                  // SSR / pre-measurement fallback so the active label isn't
                  // briefly light-on-light before the pill mounts.
                  active && !desktopPill && "bg-fg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile nav (scrollable horizontal tabs) */}
        {/* translate3d(0,0,0) promotes the bar to its own compositor layer so
            iOS Safari doesn't repaint/hide it during URL-bar collapse on
            upward scroll. Combined with safe-area padding, this keeps the
            bar pinned to the visual viewport at all times. */}
        <nav
          ref={mobileNavRef}
          className="fixed inset-x-0 bottom-0 z-50 flex gap-1 overflow-x-auto border-t border-border bg-bg-primary px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] [transform:translate3d(0,0,0)] md:hidden"
        >
          {/* Sliding active pill — sits behind the tabs, animates left/width
              to whichever tab is active. translate3d + width transition keeps
              this on the compositor instead of triggering layout. */}
          {mobilePill && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 top-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] rounded-lg bg-fg-primary transition-[transform,width] duration-300 ease-out will-change-transform"
              style={{
                transform: `translate3d(${mobilePill.left}px, 0, 0)`,
                width: mobilePill.width,
              }}
            />
          )}
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                ref={(el) => {
                  mobileItemRefs.current[item.href] = el;
                }}
                href={item.href}
                aria-label={item.label}
                // See sidenav comment above re full prefetch on dynamic routes.
                prefetch={active ? false : true}
                onClick={active ? undefined : () => setPendingHref(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative z-10 flex h-11 min-w-[3rem] items-center justify-center rounded-lg px-3 transition-colors duration-300",
                  active ? "text-bg-primary" : "text-fg-secondary"
                )}
              >
                <Icon className="h-6 w-6" />
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
