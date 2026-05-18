"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Clinic } from "@/lib/types";
import type { QuizAction, QuizState } from "./types";

interface Props {
  clinic: Clinic;
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
  privacyHref: string;
}

export function StepContact({ clinic, state, dispatch, privacyHref }: Props) {
  const isInfoOnly = state.branch === "info-only";
  return (
    <div className="step-enter space-y-4">
      <div>
        <h3 className="text-xl font-semibold text-brand-fg sm:text-2xl">
          {isInfoOnly ? "Wo dürfen wir Ihnen Informationen schicken?" : "Wie dürfen wir Sie erreichen?"}
        </h3>
        <p className="mt-1 text-brand-fg-muted">
          {isInfoOnly
            ? "Wir senden Ihnen kompakte Informationen — kein Anruf, keine Vorverkaufstaktik."
            : "Wir melden uns innerhalb eines Werktags zur Terminvereinbarung."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Vorname"
          value={state.firstName}
          onChange={(e) => dispatch({ type: "set", field: "firstName", value: e.target.value })}
          autoComplete="given-name"
          required
          error={state.errors.firstName}
        />
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
      </div>
      {!isInfoOnly && (
        <Input
          label="Telefon"
          type="tel"
          hint="Optional — beschleunigt die Terminvereinbarung."
          value={state.phone}
          onChange={(e) => dispatch({ type: "set", field: "phone", value: e.target.value })}
          autoComplete="tel"
          inputMode="tel"
          error={state.errors.phone}
        />
      )}
      <Textarea
        label="Möchten Sie uns vorab noch etwas mitteilen?"
        hint="Optional — z. B. besondere Anliegen, frühere Eingriffe oder Fragen."
        placeholder="Alles, was wir vor dem Gespräch wissen sollten."
        value={state.notes}
        onChange={(e) => dispatch({ type: "set", field: "notes", value: e.target.value })}
        maxLength={1000}
      />
      <div className="space-y-2">
        <Checkbox
          checked={state.consents.privacy}
          onCheckedChange={(v) => dispatch({ type: "setConsent", key: "privacy", value: v })}
          required
          error={state.errors.privacy}
          label={
            <>
              Ich habe die{" "}
              <a
                href={privacyHref}
                target="_blank"
                rel="noopener"
                className="underline underline-offset-4 hover:text-brand-primary"
              >
                Datenschutzerklärung
              </a>{" "}
              zur Kenntnis genommen und stimme der Verarbeitung meiner Daten zur Bearbeitung der
              Anfrage zu.
            </>
          }
        />
        <Checkbox
          checked={state.consents.ageGate}
          onCheckedChange={(v) => dispatch({ type: "setConsent", key: "ageGate", value: v })}
          required
          error={state.errors.ageGate}
          label={<>Ich bestätige, dass ich mindestens 18 Jahre alt bin.</>}
        />
        <Checkbox
          checked={state.consents.marketing}
          onCheckedChange={(v) => dispatch({ type: "setConsent", key: "marketing", value: v })}
          label={
            <>
              Ich möchte gelegentlich Informationen zu Behandlungen und Terminen von{" "}
              <strong>{clinic.name}</strong> per E-Mail erhalten (jederzeit widerrufbar).
            </>
          }
        />
        {state.consents.marketing && (
          <p className="ml-7 text-xs text-brand-fg-muted">
            Sie erhalten gleich eine Bestätigungs-E-Mail. Erst nach Klick auf den darin enthaltenen
            Bestätigungs-Link werden Ihnen Informationen zugeschickt (Double-Opt-In).
          </p>
        )}
        <Checkbox
          checked={state.consents.aiProcessing}
          onCheckedChange={(v) => dispatch({ type: "setConsent", key: "aiProcessing", value: v })}
          label={
            <>
              Ich willige ein, dass meine Freitext-Notizen aus diesem Formular zur
              KI-gestützten Einschätzung der Kaufabsicht durch <strong>OpenAI, Inc.</strong> (USA)
              verarbeitet werden (Art. 6 Abs. 1 lit. a, Art. 9 Abs. 2 lit. a, Art. 49 Abs. 1 lit. a
              DSGVO). <strong>Freiwillig</strong> — ohne Einwilligung erfolgt die Auswertung
              ausschließlich regelbasiert.
            </>
          }
        />
      </div>
    </div>
  );
}
