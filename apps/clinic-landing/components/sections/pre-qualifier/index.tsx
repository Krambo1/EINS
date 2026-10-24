"use client";

import * as React from "react";
import type { Clinic, Treatment, QuizSubmissionPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useConsent } from "@/components/consent/consent-context";
import { track } from "@/components/tracking/track";
import { extractUtmFrom } from "@/lib/attribution";
import {
  buildInitialState,
  deriveBranch,
  reducer,
  stepsFor,
  type QuizAction,
  type QuizState,
  type StepId,
} from "./types";
import { StepTreatment } from "./step-treatment";
import { StepTimeframe } from "./step-timeframe";
import { StepBudget } from "./step-budget";
import { StepDistance } from "./step-distance";
import { StepContact } from "./step-contact";
import { Confirmation } from "./confirmation";

interface Props {
  clinic: Clinic;
  treatment: Treatment;
  privacyHref: string;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Delay between tile tap and auto-advance — long enough to see the selection. */
const ADVANCE_DELAY_MS = 260;

/**
 * Quiz v2 — lives INSIDE the hero (quiz-in-hero architecture).
 *
 * Tile steps auto-advance on selection (no "Weiter" tap); only the contact
 * step has an explicit submit. Steps are derived per answer state — see
 * `stepsFor` in ./types. The progress bar starts visibly filled (endowed
 * progress) and the back arrow never destroys state.
 */
export function QuizCard({ clinic, treatment, privacyHref }: Props) {
  const consent = useConsent();
  const eventIdRef = React.useRef<string>(uuid());
  const honeypotRef = React.useRef<string>("");
  const startedRef = React.useRef(false);
  const advanceTimer = React.useRef<number | null>(null);
  const [state, dispatch] = React.useReducer(
    reducer,
    eventIdRef.current,
    buildInitialState,
  );

  React.useEffect(() => {
    return () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  const steps = stepsFor(treatment, state);
  const activeIndex = Math.min(state.stepIndex, steps.length - 1);
  const currentStep: StepId = steps[activeIndex];
  const branch = deriveBranch(state);
  const isInfoOnly = branch === "info-only";

  const fireStep = React.useCallback(
    (completed: StepId) => {
      if (!startedRef.current) {
        startedRef.current = true;
        if (consent.marketing) {
          track({ event: "QuizStart", eventId: eventIdRef.current });
        }
      }
      if (consent.marketing) {
        track({
          event: "QuizStep",
          eventId: eventIdRef.current,
          step: completed,
          branch: deriveBranch(state),
        });
      }
    },
    [consent.marketing, state],
  );

  /** Tile handler: select, show the highlight briefly, then advance. */
  const selectAndAdvance = React.useCallback(
    (field: "treatment" | "timeframe" | "budget" | "distance") => (value: string) => {
      dispatch({ type: "set", field, value });
      fireStep(field);
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(() => {
        dispatch({ type: "next" });
        advanceTimer.current = null;
      }, ADVANCE_DELAY_MS);
    },
    [fireStep],
  );

  const onBack = React.useCallback(() => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    dispatch({ type: "goto", index: activeIndex - 1 });
  }, [activeIndex]);

  const onSubmit = React.useCallback(() => {
    const errors = validateContact(state, isInfoOnly);
    if (Object.keys(errors).length > 0) {
      dispatch({ type: "errors", value: errors });
      return;
    }
    fireStep("contact");
    void submit(state, branch, clinic, treatment, honeypotRef.current, dispatch);
  }, [branch, clinic, fireStep, isInfoOnly, state, treatment]);

  if (state.submitted) {
    return (
      <div className="quiz-card p-5 sm:p-6">
        <Confirmation
          clinic={clinic}
          treatment={treatment}
          branch={branch}
          firstName={state.firstName.trim()}
          email={state.email.trim()}
          eventId={state.eventId}
        />
      </div>
    );
  }

  const isContact = currentStep === "contact";
  const responsePromise = clinic.responsePromise ?? "innerhalb eines Werktags";

  return (
    <div className="quiz-card p-5 sm:p-6">
      <ProgressBar current={activeIndex} total={steps.length} />
      <div className="mt-5">
        {currentStep === "treatment" && (
          <StepTreatment
            treatment={treatment}
            state={state}
            onSelect={selectAndAdvance("treatment")}
          />
        )}
        {currentStep === "timeframe" && (
          <StepTimeframe state={state} onSelect={selectAndAdvance("timeframe")} />
        )}
        {currentStep === "budget" && (
          <StepBudget
            treatment={treatment}
            state={state}
            onSelect={selectAndAdvance("budget")}
          />
        )}
        {currentStep === "distance" && (
          <StepDistance state={state} onSelect={selectAndAdvance("distance")} />
        )}
        {isContact && (
          <StepContact
            clinic={clinic}
            state={state}
            dispatch={dispatch}
            isInfoOnly={isInfoOnly}
            honeypotRef={honeypotRef}
          />
        )}
      </div>

      <div className="mt-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {activeIndex > 0 ? (
          <Button variant="ghost" onClick={onBack} disabled={state.submitting} className="order-2 self-start text-sm sm:order-none sm:self-end">
            ← Zurück
          </Button>
        ) : (
          <span aria-hidden />
        )}
        {isContact && (
          <div className="min-w-0 sm:flex-1">
            <p className="mb-2 text-sm text-brand-fg sm:text-right">
              <a href={privacyHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-brand-primary">
                Datenschutz
              </a>
            </p>
            <Button variant="primary" onClick={onSubmit} disabled={state.submitting} className="w-full !whitespace-normal">
              {state.submitting ? "Senden …" : isInfoOnly ? "Informationen anfordern" : "Beratungstermin anfragen"}
            </Button>
          </div>
        )}
      </div>

      {state.errors._form && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {state.errors._form}
        </p>
      )}

      <p className="mt-4 border-t border-brand-border pt-3 text-xs leading-relaxed text-brand-fg-muted">
        {isContact
          ? `Unverbindlich. Diskret. Antwort ${responsePromise}.`
          : "Dauert unter einer Minute. Keine medizinischen Daten nötig, diese besprechen Sie vertraulich im Gespräch."}
      </p>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  // Endowed progress: the bar starts visibly filled — completing feels closer
  // from the first second (Nunes & Drèze).
  const pct = Math.round(15 + 85 * (current / total));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-brand-fg-muted">
        <span>
          Schritt {current + 1} von {total}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function validateContact(state: QuizState, isInfoOnly: boolean) {
  const e: Partial<Record<string, string>> = {};
  if (!state.firstName.trim()) e.firstName = "Bitte geben Sie Ihren Vornamen an.";
  if (!EMAIL_RX.test(state.email)) e.email = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (!isInfoOnly) {
    const digits = state.phone.replace(/\D/g, "");
    if (digits.length < 8 || /^(\d)\1+$/.test(digits))
      e.phone = "Bitte eine gültige Telefonnummer angeben.";
  }
  if (!state.consent) e.consent = "Bitte bestätigen Sie Ihre Einwilligung und Ihr Mindestalter.";
  return e;
}

async function submit(
  state: QuizState,
  branch: "qualified" | "info-only",
  clinic: Clinic,
  treatment: Treatment,
  honeypot: string,
  dispatch: React.Dispatch<QuizAction>,
) {
  dispatch({ type: "submitting", value: true });

  const utm = extractUtm();
  const payload: QuizSubmissionPayload & { website?: string } = {
    clinicSlug: clinic.slug,
    treatmentSlug: treatment.slug,
    branch,
    treatment: state.treatment ?? "",
    timeframe: state.timeframe ?? undefined,
    budget: state.budget ?? undefined,
    distance: state.distance ?? undefined,
    firstName: state.firstName.trim(),
    email: state.email.trim(),
    phone: branch === "qualified" ? state.phone : undefined,
    // Optional self-report; the server keeps only the closed list (lib/self-reported-source.ts).
    selfReportedSource: state.selfReportedSource ?? undefined,
    // Final 14: explicit health-data consent and age. No inquiry data is
    // released for advertising measurement; AI processing stays disabled.
    consents: {
      privacy: state.consent,
      ageGate: state.consent,
      marketing: false,
      aiProcessing: false,
      adsMeasurement: false,
    },
    marketingConfirmedAt: null,
    website: honeypot || undefined,
    meta: {
      eventId: state.eventId,
      sourceUrl: typeof window !== "undefined" ? window.location.href : "",
      utm,
      fbc: getCookie("_fbc"),
      fbp: getCookie("_fbp"),
      ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
    },
  };

  try {
    const res = await fetch("/api/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      dispatch({
        type: "errors",
        value: { _form: json?.error ?? "Senden fehlgeschlagen, bitte erneut versuchen." },
      });
      dispatch({ type: "submitting", value: false });
      return;
    }
    dispatch({ type: "submitted" });
  } catch {
    dispatch({
      type: "errors",
      value: { _form: "Netzwerkfehler, bitte erneut versuchen." },
    });
    dispatch({ type: "submitting", value: false });
  }
}

function extractUtm(): Record<string, string> | undefined {
  if (typeof window === "undefined") return undefined;
  // The inline attribution script (components/tracking/attribution-script.tsx)
  // captured utm_* + click ids at parse time and removed utm_* from the
  // address, so read its copy first (lib/attribution.ts, tested there).
  return extractUtmFrom(window.__einsAttribution__, window.location.search);
}

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
