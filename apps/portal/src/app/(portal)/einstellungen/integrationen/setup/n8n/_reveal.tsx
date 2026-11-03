"use client";

import { useState } from "react";
import { Button, cn } from "@eins/ui";
import { showActionFlash } from "@/app/(portal)/_components/flash-event";
import { CardBody, CardFoot, Field, PRIMARY_BUTTON, Status } from "../../../_components/settings-ui";
import { ONE_LINE } from "../../../_lib/sizes";
import { rotatePvsSecretAction } from "../../actions";
import { CopyButton } from "../_copy-button";
import { SECRET_HOW, SECRET_ONCE, SECRET_OWNER_ONLY, SECRET_WELL } from "./_copy";

/**
 * The key card's body and foot. What it does is unchanged: the same action
 * mints the key, it is shown once in this browser, and a second key in the
 * same visit asks first. The key has a well of its own that keeps its size
 * with or without a key in it, and a refusal goes to the toast. Without the
 * Inhaber role the empty well says so (the action refuses those roles).
 */
export function N8nSecretReveal({ clinicId, canRotate }: { clinicId: string; canRotate: boolean }) {
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  async function rotate() {
    if (
      secret !== null &&
      !confirm(
        "Wirklich rotieren? Das alte Geheimnis wird sofort ungültig, bereits deployte Workflows funktionieren nicht mehr, bis Sie das neue Geheimnis dort eintragen."
      )
    ) {
      return;
    }
    setBusy(true);
    let error: string | null = null;
    try {
      const r = await rotatePvsSecretAction();
      if (!r.ok) {
        error = r.error;
      } else {
        setSecret(r.secretHex);
      }
    } catch {
      error = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";
    } finally {
      setBusy(false);
    }
    if (error) showActionFlash({ tone: "bad", title: "Kein Schlüssel erzeugt", description: error });
  }

  return (
    <>
      <CardBody className="space-y-5">
        <Field label="Ihre Praxis-Kennung für n8n">
          <div className="flex items-center gap-2">
            <code className={cn(ONE_LINE, "min-w-0 flex-1 font-mono text-[15px] leading-6 text-fg-primary")}>
              {clinicId}
            </code>
            <CopyButton value={clinicId} label="Praxis-Kennung kopieren" />
          </div>
        </Field>
        <Field label="Geheimer Schlüssel">
          <div
            aria-live="polite"
            className={cn(
              SECRET_WELL,
              "elev-inset flex flex-col justify-center gap-2 rounded-[var(--r-control)] bg-[var(--well)] p-3"
            )}
          >
            {secret ? (
              <>
                <div className="flex items-center gap-2">
                  <code
                    className={cn(ONE_LINE, "min-w-0 flex-1 font-mono text-[15px] text-fg-primary [--scroll-bg:var(--well)]")}
                  >
                    {secret}
                  </code>
                  <CopyButton value={secret} label="Schlüssel kopieren" />
                </div>
                <Status tone="warn" className="font-medium leading-5">
                  Dieser Schlüssel wird nur jetzt angezeigt.
                </Status>
              </>
            ) : (
              <p className="text-sm leading-5 text-fg-secondary">{canRotate ? SECRET_ONCE : SECRET_OWNER_ONLY}</p>
            )}
          </div>
          <p className="mt-1.5 text-sm leading-5 text-fg-secondary">{SECRET_HOW}</p>
        </Field>
      </CardBody>
      <CardFoot>
        <Button className={PRIMARY_BUTTON} onClick={rotate} disabled={busy} aria-busy={busy}>
          {secret ? "Neuen Schlüssel erzeugen" : "Schlüssel erzeugen"}
        </Button>
      </CardFoot>
    </>
  );
}
