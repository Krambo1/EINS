"use client";

import { useActionState, useEffect, useState } from "react";
import { cn } from "@eins/ui";
import { showActionFlash } from "../../_components/flash-event";
import { PendingSubmit } from "../../_components/PendingSubmit";
import { CardBody, CardFoot, FIELD_GRID, Field, PRIMARY_BUTTON, TextInput } from "../_components/settings-ui";
import { PASSWORD_RULE } from "./_copy";
import { changePasswordAction, type SettingsActionState } from "./actions";

/**
 * The password card's form. The action, its checks and what it ends (every
 * other session) are unchanged; the result and every error now come in the
 * toast instead of a green or red box under the fields, so the card keeps
 * its height. The one line under "Neues Passwort wiederholen" has its place
 * whether or not the two differ.
 */
export function ChangePasswordForm() {
  const [state, action] = useActionState<SettingsActionState, FormData>(changePasswordAction, undefined);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw.length > 0 && pw2.length > 0 && pw !== pw2;

  useEffect(() => {
    if (!state) return;
    showActionFlash(
      state.ok
        ? { tone: "good", title: "Passwort geändert", description: "Andere Sitzungen wurden beendet." }
        : { tone: "bad", title: "Passwort nicht geändert", description: state.error }
    );
  }, [state]);

  return (
    <form action={action}>
      <CardBody>
        <div className={cn(FIELD_GRID, "items-start")}>
          <Field label="Aktuelles Passwort" htmlFor="currentPassword" className="md:col-span-2 md:w-[calc(50%-0.5rem)]">
            <TextInput
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Neues Passwort" htmlFor="newPassword">
            <TextInput
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              aria-describedby="newPassword-rule"
            />
            <p id="newPassword-rule" className="mt-1.5 text-sm leading-5 text-fg-secondary">
              {PASSWORD_RULE}
            </p>
          </Field>
          <Field label="Neues Passwort wiederholen" htmlFor="newPassword2">
            <TextInput
              id="newPassword2"
              name="newPassword2"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              aria-invalid={mismatch || undefined}
              aria-describedby="newPassword2-mismatch"
            />
            <p id="newPassword2-mismatch" aria-live="polite" className="mt-1.5 min-h-5 text-sm leading-5 text-tone-bad">
              {mismatch ? "Die Eingaben stimmen nicht überein." : null}
            </p>
          </Field>
        </div>
      </CardBody>
      <CardFoot>
        <PendingSubmit className={PRIMARY_BUTTON} disabled={mismatch}>
          Passwort ändern
        </PendingSubmit>
      </CardFoot>
    </form>
  );
}
