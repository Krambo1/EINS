"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { healthConsentText } from "@/lib/legal/health-consent";
import { LANDING_SELF_REPORTED_SOURCE_OPTIONS } from "@/lib/self-reported-source";
import { cn } from "@/lib/utils";
import type { Clinic } from "@/lib/types";
import type { QuizAction, QuizState } from "./types";

interface Props {
  clinic: Clinic;
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
  isInfoOnly: boolean;
  /** Honeypot value lives outside the reducer — bots fill it, humans never see it. */
  honeypotRef: React.MutableRefObject<string>;
}

/**
 * Contact step v2 — exactly 3 fields on the qualified branch (Vorname,
 * Telefon, E-Mail), 2 on the info branch (no phone). One combined consent
 * checkbox (Final 14 health-data consent + 18+); marketing opt-in moved
 * to the confirmation screen, notes + AI consent removed entirely.
 */
export function StepContact({ clinic, state, dispatch, isInfoOnly, honeypotRef }: Props) {
  const responsePromise = clinic.responsePromise ?? "innerhalb eines Werktags";
  return (
    <div className="step-enter space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-brand-fg sm:text-xl">
          {isInfoOnly ? "Wohin dürfen wir die Informationen schicken?" : "Wie erreichen wir Sie am besten?"}
        </h3>
        <p className="mt-1 text-sm text-brand-fg-muted">
          {isInfoOnly
            ? "Sie erhalten kompakte Informationen per E-Mail. Es ruft Sie niemand an."
            : `Ihre Angaben werden vertraulich behandelt. Antwort ${responsePromise}.`}
        </p>
      </div>
      <Input
        label="Vorname"
        value={state.firstName}
        onChange={(e) => dispatch({ type: "set", field: "firstName", value: e.target.value })}
        autoComplete="given-name"
        required
        error={state.errors.firstName}
      />
      {!isInfoOnly && (
        <Input
          label="Telefon"
          type="tel"
          hint="Nur zur Terminabstimmung. Kein Verkaufsanruf."
          value={state.phone}
          onChange={(e) => dispatch({ type: "set", field: "phone", value: e.target.value })}
          autoComplete="tel"
          inputMode="tel"
          required
          error={state.errors.phone}
        />
      )}
      <Input
        label="E-Mail"
        type="email"
        value={state.email}
        onChange={(e) => dispatch({ type: "set", field: "email", value: e.target.value })}
        autoComplete="email"
        inputMode="email"
        required
        error={state.errors.email}
      />
      {/* Honeypot — visually hidden, tab-skipped. Bots that fill every field
          trip it; the server silently 202s. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
            onChange={(e) => {
              honeypotRef.current = e.target.value;
            }}
          />
        </label>
      </div>
      {/* Optional self-report: one tap, tap again to undo, no validation.
          Closed list, no free text (lib/self-reported-source.ts). */}
      <fieldset className="min-w-0">
        <legend className="mb-1.5 block text-sm font-medium text-brand-fg">
          Wie sind Sie auf uns aufmerksam geworden?{" "}
          <span className="font-normal text-brand-fg-muted">(freiwillig)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {LANDING_SELF_REPORTED_SOURCE_OPTIONS.map((opt) => {
            const selected = state.selfReportedSource === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  dispatch({ type: "setSelfReportedSource", value: selected ? null : opt.id })
                }
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2",
                  selected
                    ? "border-brand-primary bg-brand-primary-soft font-medium text-brand-fg"
                    : "border-brand-border bg-white text-brand-fg hover:border-brand-primary",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Checkbox
        checked={state.consent}
        onCheckedChange={(v) => dispatch({ type: "setConsent", value: v })}
        required
        error={state.errors.consent}
        label={
          <>
            Ich bin mindestens 18 Jahre alt.{" "}
            {healthConsentText(clinic.privacySheet.email)}
          </>
        }
      />
      <p className="text-xs leading-relaxed text-brand-fg-muted">
        Ohne Einwilligung können Sie Ihren Termin direkt unter{" "}
        <a href={`tel:${clinic.contact.phoneE164}`} className="underline underline-offset-4">{clinic.contact.phoneDisplay}</a>{" "}
        oder per <a href={`mailto:${clinic.privacySheet.email}`} className="underline underline-offset-4">E-Mail</a> vereinbaren.
      </p>
    </div>
  );
}
