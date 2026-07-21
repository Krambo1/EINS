"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Clinic } from "@/lib/types";
import type { QuizAction, QuizState } from "./types";

interface Props {
  clinic: Clinic;
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
  privacyHref: string;
  isInfoOnly: boolean;
  /** Honeypot value lives outside the reducer — bots fill it, humans never see it. */
  honeypotRef: React.MutableRefObject<string>;
}

/**
 * Contact step v2 — exactly 3 fields on the qualified branch (Vorname,
 * Telefon, E-Mail), 2 on the info branch (no phone). One combined consent
 * checkbox (Datenschutz + 18+, Art. 6 (1) b DSGVO); marketing opt-in moved
 * to the confirmation screen, notes + AI consent removed entirely.
 */
export function StepContact({ clinic, state, dispatch, privacyHref, isInfoOnly, honeypotRef }: Props) {
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
      <Checkbox
        checked={state.consent}
        onCheckedChange={(v) => dispatch({ type: "setConsent", value: v })}
        required
        error={state.errors.consent}
        label={
          <>
            Ich bin mindestens 18 Jahre alt und habe die{" "}
            <a
              href={privacyHref}
              target="_blank"
              rel="noopener"
              className="underline underline-offset-4 hover:text-brand-primary"
            >
              Datenschutzerklärung
            </a>{" "}
            zur Kenntnis genommen.
          </>
        }
      />
    </div>
  );
}
