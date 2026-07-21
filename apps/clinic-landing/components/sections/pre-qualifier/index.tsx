"use client";

import * as React from "react";
import type { Clinic, Treatment, QuizSubmissionPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useConsent } from "@/components/consent/consent-context";
import { track } from "@/components/tracking/track";
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
          track({
            event: "QuizStart",
            eventId: eventIdRef.current,
            treatment: treatment.slug,
          });
        }
      }
      if (consent.marketing) {
        track({
          event: "QuizStep",
          eventId: eventIdRef.current,
          step: completed,
          treatment: treatment.slug,
          branch: deriveBranch(state),
        });
      }
    },
    [consent.marketing, state, treatment.slug],
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
            privacyHref={privacyHref}
            isInfoOnly={isInfoOnly}
            honeypotRef={honeypotRef}
          />
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        {activeIndex > 0 ? (
          <Button variant="ghost" onClick={onBack} disabled={state.submitting} className="text-sm">
            ← Zurück
          </Button>
        ) : (
          <span aria-hidden />
        )}
        {isContact && (
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={state.submitting}
            className="flex-1 sm:flex-none"
          >
            {state.submitting
              ? "Senden …"
              : isInfoOnly
                ? "Informationen anfordern"
                : "Beratungstermin anfragen"}
          </Button>
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
  if (!state.consent) e.consent = "Bitte bestätigen Sie Datenschutz und Mindestalter.";
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
    // Quiz v2: the combined checkbox covers privacy + age; marketing moved to
    // the confirmation screen (starts false, DOI flips it); the notes field
    // and its AI-scoring consent were removed — aiProcessing is always false.
    consents: {
      privacy: state.consent,
      ageGate: state.consent,
      marketing: false,
      aiProcessing: false,
    },
    marketingConfirmedAt: null,
    website: honeypot || undefined,
    meta: {
      eventId: state.eventId,
      sourceUrl: typeof window !== "undefined" ? window.location.href : "",
      utm: extractUtm(),
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
    // Lead fires ONLY for the qualified branch — the pixel keeps optimizing
    // on full leads, not info requests.
    if (branch === "qualified") {
      track({
        event: "Lead",
        eventId: state.eventId,
        treatment: treatment.slug,
        branch,
      });
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
  const sp = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("utm_")) out[k] = v;
    if (k === "fbclid" || k === "gclid" || k === "ttclid") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
