"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { driver, type Driver } from "driver.js";
import { Compass, CheckCircle2, X } from "lucide-react";
import "driver.js/dist/driver.css";
import "./tour.css";
import type { TourStep } from "./types";
import { CORE_STEPS } from "./coreSteps";
import { CHAPTERS, type ChapterKey } from "./chapterSteps";
import {
  completeOnboardingTourAction,
  dismissOnboardingTourAction,
  dismissTourNavCardAction,
} from "./actions";

interface TourContextValue {
  /** Start a tour from the given ordered step list. Does not record completion. */
  start: (steps: TourStep[]) => void;
  /** Start the core showcase tour. Used by the first-login prompt and the
   *  Einstellungen re-launch card so neither needs to know the step list.
   *  Reaching the end records onboarding completion. */
  startCore: () => void;
  /** Start an on-demand deep-dive chapter by key. Never records completion. */
  startChapter: (key: ChapterKey) => void;
  /** Stop and tear down the running tour without recording completion. */
  stop: () => void;
  isRunning: boolean;
  /** Whether the left-nav tour card should render right now. */
  navCardVisible: boolean;
  /** Permanently dismiss the left-nav tour card (its X). */
  dismissNavCard: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within <TourProvider>");
  return ctx;
}

const STEP_TIMEOUT_MS = 6000;
// Skippable (data-dependent) steps wait only briefly: their target is rendered
// with the page, so if it isn't present shortly after the route settles it is
// never coming. A full STEP_TIMEOUT_MS per missing step would freeze the tour
// for seconds on an empty account (the new-Inhaber first-login case).
const SKIP_TIMEOUT_MS = 2500;

/** First *visible* element matching the selector (skips 0x0 / hidden dupes). */
function findVisible(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

// Poll interval for the wait helpers. We use setTimeout rather than
// requestAnimationFrame on purpose: rAF is paused/throttled when the tab is
// backgrounded, which would hang a step mid-tour (and also breaks headless
// verification). setTimeout keeps firing regardless of visibility.
const POLL_MS = 50;

function waitForElement(
  selector: string,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = () => {
      const el = findVisible(selector);
      if (el) return resolve(el);
      if (performance.now() - startedAt > timeoutMs) return resolve(null);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

function pathMatches(route: string): boolean {
  const p = window.location.pathname;
  return p === route || p.startsWith(`${route}/`);
}

function waitForPath(route: string, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    if (pathMatches(route)) return resolve();
    const startedAt = performance.now();
    const tick = () => {
      if (pathMatches(route) || performance.now() - startedAt > timeoutMs) {
        return resolve();
      }
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

const settleFrame = () => new Promise<void>((r) => setTimeout(r, POLL_MS));

/**
 * OS "reduce motion" preference. Read fresh each time (per tour start / driver
 * build) so a mid-session change in system settings is respected. SSR-safe:
 * matchMedia is feature-detected. The tour's *own* CSS animations (prompt +
 * centered cards) are already gated in tour.css; this gates driver.js' spotlight
 * stage transition, which CSS can't reach.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Focusable descendants of a container, in DOM order, visible only. */
function focusablesIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const sel =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => el.offsetParent !== null,
  );
}

export function TourProvider({
  children,
  /** Show the gentle first-login prompt on mount. Computed server-side
   *  (Inhaber, both tour flags null, not impersonating, onboarding done). */
  autoPrompt = false,
  /** Whether this user may ever see the left-nav tour card (Inhaber, not
   *  impersonating, hasn't permanently dismissed it). */
  navCardEligible = false,
  /** Whether the nav card should be visible on first paint (eligible + the
   *  prompt was already skipped / the tour abandoned, never completed). */
  navCardInitiallyVisible = false,
}: {
  children: ReactNode;
  autoPrompt?: boolean;
  navCardEligible?: boolean;
  navCardInitiallyVisible?: boolean;
}) {
  const router = useRouter();

  const driverRef = useRef<Driver | null>(null);
  const stepsRef = useRef<TourStep[]>([]);
  const indexRef = useRef(0);
  const busyRef = useRef(false);
  // Element focused when the tour started (the re-launch button / prompt CTA),
  // so we can return focus there on close instead of dropping keyboard users at
  // the top of the page.
  const launchFocusRef = useRef<HTMLElement | null>(null);
  // The centered-card dialog element, for initial focus + Tab-trapping while a
  // welcome / finish card is up (driver.js owns focus for spotlight steps).
  const centeredCardRef = useRef<HTMLDivElement | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  // Index of the step currently shown as a centered EINS card (welcome /
  // finish, or a spotlight target that never mounted). null = a driver
  // spotlight is showing instead. Driving these from React (rather than
  // driver.js' element-less popover) lets us own a clean full overlay with no
  // lingering spotlight stage and no click bleed-through to the page beneath.
  const [centeredIndex, setCenteredIndex] = useState<number | null>(null);
  // Initialized once from the server-computed prop. The provider lives in the
  // portal layout and persists across soft navigations, so once the user
  // resolves the prompt it stays gone for the session without a re-fetch.
  const [showPrompt, setShowPrompt] = useState(autoPrompt);
  // Left-nav tour card. Server gives the initial state; the prompt/finish/abandon
  // handlers below flip it live during the session. Once killed (X'd) the ref
  // keeps it from being resurrected by a later abandon in the same session.
  const [navCardVisible, setNavCardVisible] = useState(navCardInitiallyVisible);
  const navCardKilledRef = useRef(false);

  // When we tear down the driver *intentionally* to swap in a centered card,
  // this flag tells driver's onDestroyed handler not to also end the tour.
  const suppressDestroyRef = useRef(false);
  // Whether reaching the end of this run records onboarding completion. True
  // only for the core showcase tour; deep-dive chapters are pure walkthroughs.
  const recordsCompletionRef = useRef(false);
  // Latest goToStep / stop, read by the (stable) driver callbacks via refs so
  // ensureDriver has no dependency on them — breaks the callback cycle
  // (ensureDriver -> goToStep -> showStep -> ensureDriver).
  const goToStepRef = useRef<(index: number) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    // A core tour torn down while it still "records completion" was abandoned
    // before "Fertig" — resurface the nav card (unless ineligible or killed).
    // finish() clears the flag first, so a real completion never lands here.
    if (
      recordsCompletionRef.current &&
      navCardEligible &&
      !navCardKilledRef.current
    ) {
      setNavCardVisible(true);
    }
    recordsCompletionRef.current = false;

    const d = driverRef.current;
    driverRef.current = null;
    busyRef.current = false;
    setIsRunning(false);
    setCenteredIndex(null);
    d?.destroy();
    // Return focus to whatever launched the tour, if it's still mounted (the
    // auto-prompt CTA unmounts on accept, so this no-ops there — acceptable).
    const trigger = launchFocusRef.current;
    launchFocusRef.current = null;
    if (trigger && trigger.isConnected) trigger.focus();
  }, [navCardEligible]);

  // Reached the end ("Fertig"): record completion (core tour only), then tear
  // down. Fire-and-forget the write so teardown isn't blocked on the round-trip.
  const finish = useCallback(() => {
    const wasCore = recordsCompletionRef.current;
    // Consume the flag *before* stop() so it doesn't read this as an abandon.
    recordsCompletionRef.current = false;
    if (wasCore) {
      void completeOnboardingTourAction();
      // A completed tour never needs the nav card again.
      navCardKilledRef.current = true;
      setNavCardVisible(false);
    }
    stop();
  }, [stop]);

  const ensureDriver = useCallback(() => {
    if (driverRef.current) return;
    driverRef.current = driver({
      // Skip the spotlight stage's slide/scale transitions when the OS asks for
      // reduced motion. Read at build time; start() rebuilds the driver per run.
      animate: !prefersReducedMotion(),
      showProgress: false,
      showButtons: ["next", "previous", "close"],
      allowClose: true,
      disableActiveInteraction: true,
      overlayColor: "#10101a",
      overlayOpacity: 0.55,
      stagePadding: 8,
      stageRadius: 14,
      popoverClass: "eins-tour-popover",
      onPopoverRender: (popover) => {
        const i = indexRef.current;
        const total = stepsRef.current.length;
        const isFirst = i === 0;
        const isLast = i === total - 1;

        // Progress line (driver's own progress doesn't apply in highlight mode).
        popover.wrapper.querySelector(".eins-tour-progress")?.remove();
        const prog = document.createElement("div");
        prog.className = "eins-tour-progress";
        prog.textContent = `Schritt ${i + 1} von ${total}`;
        popover.wrapper.insertBefore(prog, popover.wrapper.firstChild);

        if (popover.nextButton) {
          popover.nextButton.textContent = isLast ? "Fertig" : "Weiter";
        }
        if (popover.previousButton) {
          popover.previousButton.textContent = "Zurück";
          popover.previousButton.style.display = isFirst ? "none" : "";
        }
        if (popover.closeButton) {
          popover.closeButton.setAttribute("aria-label", "Rundgang beenden");
        }
      },
      // We drive navigation ourselves, so these override driver's defaults
      // (which would otherwise destroy the tour on the last step). They read
      // the latest handlers via refs so this instance never goes stale.
      onNextClick: () => goToStepRef.current(indexRef.current + 1),
      onPrevClick: () => goToStepRef.current(indexRef.current - 1),
      onCloseClick: () => stopRef.current(),
      onDestroyed: () => {
        // Ignore the teardown we triggered ourselves to show a centered card.
        if (suppressDestroyRef.current) {
          suppressDestroyRef.current = false;
          return;
        }
        busyRef.current = false;
        setIsRunning(false);
        setCenteredIndex(null);
      },
    });
  }, []);

  const showStep = useCallback(
    (index: number, element: HTMLElement | null) => {
      const step = stepsRef.current[index];
      if (!step) return;

      // No resolved element -> centered EINS card (welcome / finish, or a
      // spotlight whose target never mounted). Tear down any live driver first
      // so its spotlight stage and overlay don't linger behind the card; the
      // suppress flag keeps that teardown from ending the tour.
      if (!element) {
        if (driverRef.current) {
          suppressDestroyRef.current = true;
          driverRef.current.destroy();
          driverRef.current = null;
        }
        setCenteredIndex(index);
        return;
      }

      // Spotlight step: ensure a driver exists, clear any centered card, and
      // highlight the resolved element.
      setCenteredIndex(null);
      ensureDriver();
      driverRef.current?.highlight({
        element,
        popover: {
          title: step.title,
          description: step.body,
          side: step.side ?? "right",
          align: step.align ?? "start",
          // driver.js only honors the *global* showButtons in drive() mode; a
          // lone highlight() defaults to no buttons and collapses the footer to
          // display:none (driver.js.mjs renderPopover). We navigate via
          // highlight() per step, so the footer (Weiter / Zurück) must be opted
          // in here or the user is left with a card and no way forward.
          showButtons: ["next", "previous", "close"],
          popoverClass: "eins-tour-popover",
        },
      });
    },
    [ensureDriver],
  );

  const goToStep = useCallback(
    async (index: number) => {
      const steps = stepsRef.current;
      if (index < 0) return;
      if (index >= steps.length) return finish();
      if (busyRef.current) return;

      // Direction of travel (Weiter vs Zurück), captured before we move the
      // cursor, so a skipped step continues the same way.
      const forward = index >= indexRef.current;

      busyRef.current = true;
      indexRef.current = index;
      const step = steps[index];

      if (step.route && !pathMatches(step.route)) {
        router.push(step.route);
        await waitForPath(step.route);
      }

      let element: HTMLElement | null = null;
      if (step.element) {
        element = await waitForElement(
          step.element,
          step.skipIfMissing ? SKIP_TIMEOUT_MS : STEP_TIMEOUT_MS,
        );
        // Optional spotlight whose target never mounted (data-dependent section
        // on an empty account): skip past it instead of showing a card pointed
        // at nothing. Continue in the direction the user was heading.
        if (!element && step.skipIfMissing) {
          busyRef.current = false;
          goToStepRef.current(forward ? index + 1 : index - 1);
          return;
        }
      } else {
        // Centered card: let the destination paint first.
        await settleFrame();
        await settleFrame();
      }

      showStep(index, element);
      busyRef.current = false;
    },
    [router, showStep, finish],
  );

  // Keep the refs the driver callbacks read pointed at the latest closures.
  goToStepRef.current = (index: number) => void goToStep(index);
  stopRef.current = stop;

  const start = useCallback(
    (steps: TourStep[], recordCompletion = false) => {
      if (!steps.length) return;
      // Remember the launching control so we can restore focus on close.
      launchFocusRef.current =
        (document.activeElement as HTMLElement | null) ?? null;
      suppressDestroyRef.current = false;
      recordsCompletionRef.current = recordCompletion;
      driverRef.current?.destroy();
      driverRef.current = null;
      stepsRef.current = steps;
      indexRef.current = 0;
      busyRef.current = false;
      setCenteredIndex(null);
      setIsRunning(true);
      void goToStep(0);
    },
    [goToStep],
  );

  // Only the core showcase tour records onboarding completion on "Fertig".
  const startCore = useCallback(() => start(CORE_STEPS, true), [start]);
  const startChapter = useCallback(
    (key: ChapterKey) => start(CHAPTERS[key].steps, false),
    [start],
  );

  // First-login prompt handlers. Both resolve the one-time prompt (set the
  // dismissed flag) so it never auto-shows again; "starten" additionally
  // launches the tour, and reaching the end then records completion.
  const acceptPrompt = useCallback(() => {
    setShowPrompt(false);
    void dismissOnboardingTourAction("started");
    startCore();
  }, [startCore]);

  const skipPrompt = useCallback(() => {
    setShowPrompt(false);
    void dismissOnboardingTourAction("skipped");
    // "Nein/Später" → surface the re-entry card in the nav.
    if (navCardEligible && !navCardKilledRef.current) setNavCardVisible(true);
  }, [navCardEligible]);

  // X on the nav card: gone for good this session and persisted server-side.
  const dismissNavCard = useCallback(() => {
    navCardKilledRef.current = true;
    setNavCardVisible(false);
    void dismissTourNavCardAction();
  }, []);

  // While a centered card is up, driver isn't mounted to manage focus or catch
  // Escape, so wire both here: move focus into the dialog, trap Tab within it,
  // and let Esc close the tour (records nothing), matching the spotlight steps.
  useEffect(() => {
    if (centeredIndex === null) return;
    // Initial focus: the primary action (last focusable), so Enter advances.
    const items = focusablesIn(centeredCardRef.current);
    (items[items.length - 1] ?? centeredCardRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = focusablesIn(centeredCardRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        centeredCardRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === centeredCardRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [centeredIndex, stop]);

  // Tear down if the provider unmounts mid-tour.
  useEffect(() => () => driverRef.current?.destroy(), []);

  const centeredStep =
    centeredIndex !== null ? stepsRef.current[centeredIndex] : null;
  const total = stepsRef.current.length;
  const isLastCentered = centeredIndex !== null && centeredIndex === total - 1;
  const isFirstCentered = centeredIndex === 0;

  return (
    <TourContext.Provider
      value={{
        start,
        startCore,
        startChapter,
        stop,
        isRunning,
        navCardVisible,
        dismissNavCard,
      }}
    >
      {children}

      {/* Centered welcome / finish card. Owns its own full overlay so there's
          no leftover spotlight stage and clicks can't fall through to the
          page beneath. */}
      {isRunning && centeredStep && centeredIndex !== null && (
        <div
          className="eins-tour-centered-overlay fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(16, 16, 26, 0.55)" }}
        >
          <div
            ref={centeredCardRef}
            role="dialog"
            aria-modal="true"
            aria-label={centeredStep.title}
            tabIndex={-1}
            className="eins-tour-centered-card relative w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-bg-primary p-6 shadow-2xl outline-none"
          >
            <button
              type="button"
              onClick={stop}
              aria-label="Rundgang beenden"
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-tertiary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
            >
              <X className="h-4 w-4" />
            </button>

            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/40 text-accent">
              {isLastCentered ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : (
                <Compass className="h-6 w-6" />
              )}
            </span>

            <p className="mt-4 text-xs font-medium text-fg-tertiary">
              Schritt {centeredIndex + 1} von {total}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-fg-primary">
              {centeredStep.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
              {centeredStep.body}
            </p>

            <div className="mt-6 flex items-center justify-end gap-2">
              {!isFirstCentered && (
                <button
                  type="button"
                  onClick={() => void goToStep(centeredIndex - 1)}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-secondary"
                >
                  Zurück
                </button>
              )}
              <button
                type="button"
                onClick={() => void goToStep(centeredIndex + 1)}
                className="rounded-xl bg-fg-primary px-4 py-2 text-sm font-semibold text-bg-primary transition-colors hover:opacity-90"
              >
                {isLastCentered ? "Fertig" : "Weiter"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrompt && !isRunning && (
        <div
          role="dialog"
          aria-label="Portal-Rundgang"
          className="eins-tour-prompt fixed bottom-5 right-5 z-30 w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl border border-border bg-bg-primary p-5 shadow-xl"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/40 text-accent">
              <Compass className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-fg-primary">
                Willkommen in Ihrem Portal
              </h2>
              <p className="mt-1 text-sm text-fg-secondary">
                Ein kurzer Rundgang zeigt Ihnen, wo alles liegt und was EINS für
                Sie übernimmt. Dauert nur wenige Minuten.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={skipPrompt}
              className="rounded-xl px-3 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-secondary"
            >
              Später
            </button>
            <button
              type="button"
              onClick={acceptPrompt}
              className="rounded-xl bg-fg-primary px-4 py-2 text-sm font-semibold text-bg-primary transition-colors hover:opacity-90"
            >
              Rundgang starten
            </button>
          </div>
        </div>
      )}
    </TourContext.Provider>
  );
}
