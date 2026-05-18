"use client";

import * as React from "react";
import type { Clinic, Treatment, QuizSubmissionPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useConsent } from "@/components/consent/consent-context";
import { track } from "@/components/tracking/track";
import { buildInitialState, reducer, type QuizState } from "./types";
import { StepTreatment } from "./step-treatment";
import { StepTimeframe } from "./step-timeframe";
import { StepExperience } from "./step-experience";
import { StepLocation } from "./step-location";
import { StepContact } from "./step-contact";
import { Confirmation } from "./confirmation";

interface Props {
  clinic: Clinic;
  treatment: Treatment;
  privacyHref: string;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 4-step (5 with experience) state machine.
 *
 * Step numbering depends on `treatment.quiz.askExperience`:
 *   askExperience=false   →  1: treatment, 2: timeframe, 3: location, 4: contact
 *   askExperience=true    →  1: treatment, 2: timeframe, 3: experience, 4: location, 5: contact
 *
 * The "Ich informiere mich nur" path skips experience+location and jumps to a
 * shorter contact step (email only, no phone, marketing-leaning copy).
 */
export function PreQualifier({ clinic, treatment, privacyHref }: Props) {
  const consent = useConsent();
  const eventIdRef = React.useRef<string>(uuid());
  const [state, dispatch] = React.useReducer(
    reducer,
    treatment,
    (t) => buildInitialState(t, eventIdRef.current),
  );

  const askExperience = Boolean(treatment.quiz.askExperience);
  const isInfoOnly = state.branch === "info-only";

  // Compute the active step component based on branch + askExperience.
  const stepNode = React.useMemo(() => {
    if (state.submitted) return null;
    if (isInfoOnly && state.step >= 3) {
      // info-only short-circuits to contact at step 3
      return <StepContact clinic={clinic} state={state} dispatch={dispatch} privacyHref={privacyHref} />;
    }
    switch (state.step) {
      case 1:
        return <StepTreatment treatment={treatment} state={state} dispatch={dispatch} />;
      case 2:
        return <StepTimeframe state={state} dispatch={dispatch} />;
      case 3:
        return askExperience ? (
          <StepExperience state={state} dispatch={dispatch} />
        ) : (
          <StepLocation treatment={treatment} state={state} dispatch={dispatch} />
        );
      case 4:
        return askExperience ? (
          <StepLocation treatment={treatment} state={state} dispatch={dispatch} />
        ) : (
          <StepContact clinic={clinic} state={state} dispatch={dispatch} privacyHref={privacyHref} />
        );
      case 5:
        return <StepContact clinic={clinic} state={state} dispatch={dispatch} privacyHref={privacyHref} />;
      default:
        return null;
    }
  }, [askExperience, clinic, isInfoOnly, privacyHref, state, treatment]);

  const onNext = React.useCallback(() => {
    const errors = validateStep(state, treatment, askExperience, isInfoOnly);
    if (Object.keys(errors).length > 0) {
      dispatch({ type: "errors", value: errors });
      return;
    }

    // Fire QuizStep event with marketing consent only (server route checks too).
    if (consent.marketing) {
      track({
        event: "QuizStep",
        eventId: eventIdRef.current,
        step: String(state.step),
        treatment: treatment.slug,
        branch: state.branch ?? "qualified",
      });
    }

    const isLast =
      (isInfoOnly && state.step === 3) ||
      (!isInfoOnly && state.step === state.totalSteps);

    if (isLast) {
      void submit(state, clinic, treatment, dispatch);
    } else {
      dispatch({ type: "next" });
    }
  }, [askExperience, clinic, consent.marketing, isInfoOnly, state, treatment]);

  const onBack = React.useCallback(() => dispatch({ type: "back" }), []);

  if (state.submitted && state.branch) {
    return (
      <section id="anfrage" className="bg-brand-bg-soft">
        <div className="container mx-auto max-w-3xl py-14 md:py-20">
          <Confirmation
            clinic={clinic}
            branch={state.branch}
            marketingPending={state.consents.marketing}
          />
        </div>
      </section>
    );
  }

  const isFinalStep =
    (isInfoOnly && state.step === 3) ||
    (!isInfoOnly && state.step === state.totalSteps);

  return (
    <section id="anfrage" className="bg-brand-bg-soft">
      <div className="container mx-auto max-w-3xl py-14 md:py-20">
        <p className="eyebrow">Anfrage zur Beratung</p>
        <h2 className="mt-3">In 60 Sekunden zum passenden Termin</h2>
        <p className="mt-3 max-w-prose text-brand-fg-muted">
          Sie beantworten 4 kurze Fragen, dann melden wir uns mit einem Vorschlag. Keine medizinischen
          Daten — diese besprechen wir vertraulich im Beratungsgespräch.
        </p>

        <div className="mt-6 rounded-brand-lg border border-brand-border bg-brand-bg p-5 sm:p-7">
          <ProgressBar
            current={state.step}
            total={isInfoOnly ? 3 : state.totalSteps}
          />
          <div className="mt-6">{stepNode}</div>
          <div className="mt-7 flex items-center justify-between gap-3">
            {state.step > 1 ? (
              <Button variant="ghost" onClick={onBack} disabled={state.submitting}>
                ← Zurück
              </Button>
            ) : (
              <span aria-hidden />
            )}
            <Button variant="primary" onClick={onNext} disabled={state.submitting}>
              {state.submitting
                ? "Senden …"
                : isFinalStep
                  ? isInfoOnly
                    ? "Informationen anfordern"
                    : "Anfrage senden"
                  : "Weiter →"}
            </Button>
          </div>
          {state.serverMessage && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {state.serverMessage}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.min(100, Math.round((current / total) * 100));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-brand-fg-muted">
        <span>
          Schritt {Math.min(current, total)} von {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function validateStep(
  state: QuizState,
  _treatment: Treatment,
  askExperience: boolean,
  isInfoOnly: boolean,
): Partial<Record<string, string>> {
  const e: Partial<Record<string, string>> = {};
  if (state.step === 1 && !state.treatment) e.treatment = "Bitte wählen Sie einen Bereich aus.";
  if (state.step === 2 && !state.timeframe) e.timeframe = "Bitte wählen Sie ein Zeitfenster.";

  if (!isInfoOnly) {
    if (askExperience && state.step === 3 && !state.experience)
      e.experience = "Bitte wählen Sie eine Option.";
    const locStep = askExperience ? 4 : 3;
    if (state.step === locStep && !state.city.trim()) e.city = "Bitte geben Sie Ihre Stadt an.";
    if (state.step === state.totalSteps) Object.assign(e, validateContact(state, false));
  } else {
    if (state.step === 3) Object.assign(e, validateContact(state, true));
  }
  return e;
}

function validateContact(state: QuizState, isInfoOnly: boolean) {
  const e: Partial<Record<string, string>> = {};
  if (!state.firstName.trim()) e.firstName = "Bitte geben Sie Ihren Vornamen an.";
  if (!EMAIL_RX.test(state.email)) e.email = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (!isInfoOnly && state.phone) {
    const digits = state.phone.replace(/\D/g, "");
    if (digits.length < 8 || /^(\d)\1+$/.test(digits))
      e.phone = "Bitte eine gültige Telefonnummer angeben.";
  }
  if (!state.consents.privacy) e.privacy = "Bitte stimmen Sie der Datenschutzerklärung zu.";
  if (!state.consents.ageGate) e.ageGate = "Bitte bestätigen Sie das Mindestalter.";
  return e;
}

async function submit(
  state: QuizState,
  clinic: Clinic,
  treatment: Treatment,
  dispatch: React.Dispatch<import("./types").QuizAction>,
) {
  dispatch({ type: "submitting", value: true });
  const branch = state.branch ?? "qualified";

  const payload: QuizSubmissionPayload = {
    clinicSlug: clinic.slug,
    treatmentSlug: treatment.slug,
    branch,
    treatment: state.treatment ?? "",
    timeframe: state.timeframe ?? undefined,
    experience: state.experience ?? undefined,
    city: state.city || undefined,
    firstName: state.firstName,
    email: state.email,
    phone: state.phone || undefined,
    notes: state.notes.trim() || undefined,
    consents: state.consents,
    marketingConfirmedAt: null,
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
        value: { _form: json?.error ?? "Senden fehlgeschlagen — bitte erneut versuchen." },
      });
      dispatch({ type: "submitting", value: false });
      return;
    }
    track({
      event: "Lead",
      eventId: state.eventId,
      treatment: treatment.slug,
      branch,
    });
    dispatch({ type: "submitted" });
  } catch {
    dispatch({
      type: "errors",
      value: { _form: "Netzwerkfehler — bitte erneut versuchen." },
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
