"use client";

import { useState } from "react";
import { Button, cn } from "@eins/ui";
import { showActionFlash } from "@/app/(portal)/_components/flash-event";
import { CardBody, CardFoot, Field, PRIMARY_BUTTON, TextInput } from "../../../_components/settings-ui";
import { ONE_LINE } from "../../../_lib/sizes";
import { issueAgentEnrollmentAction } from "../../actions";
import { CopyButton } from "../_copy-button";
import { CODE_WELL, FINGERPRINT_HINT, ONCE, OWNER_ONLY } from "./_copy";

/**
 * The code card's body and foot. What it does is unchanged: the optional
 * computer name goes to the same action, the code comes back once and is
 * shown only in this browser until the page is left. The code now has a
 * well of its own that keeps its size whether a code is in it or not, the
 * install command sits under it, and a refusal goes to the toast. Without
 * the Inhaber role the empty well says so (the action refuses those roles).
 */
export function GdtAgentEnroll({ canIssue }: { canIssue: boolean }) {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState("");

  async function generate() {
    setBusy(true);
    setToken(null);
    let error: string | null = null;
    try {
      const r = await issueAgentEnrollmentAction({
        expectedFingerprint: fingerprint.trim() || undefined,
      });
      if (!r.ok) {
        error = r.error;
      } else {
        setToken(r.token);
      }
    } catch {
      error = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";
    } finally {
      setBusy(false);
    }
    if (error) showActionFlash({ tone: "bad", title: "Kein Code erzeugt", description: error });
  }

  return (
    <>
      <CardBody className="space-y-5">
        <Field label="Name des Praxisrechners (optional)" htmlFor="fingerprint">
          <TextInput
            id="fingerprint"
            placeholder="z.B. PRAXIS-PC-01"
            value={fingerprint}
            onChange={(e) => setFingerprint(e.target.value)}
            aria-describedby="fingerprint-hint"
            className="md:w-[calc(50%-0.5rem)]"
          />
          <p id="fingerprint-hint" className="mt-1.5 text-sm leading-5 text-fg-secondary">
            {FINGERPRINT_HINT}
          </p>
        </Field>
        <div
          aria-live="polite"
          className={cn(
            CODE_WELL,
            "elev-inset flex flex-col justify-center gap-2 rounded-[var(--r-control)] bg-[var(--well)] p-3"
          )}
        >
          {token ? (
            <>
              <div className="flex items-center gap-2">
                <code className={cn(ONE_LINE, "min-w-0 flex-1 font-mono text-[15px] text-fg-primary [--scroll-bg:var(--well)]")}>
                  {token}
                </code>
                <CopyButton value={token} label="Code kopieren" />
              </div>
              <div className="flex items-center gap-2">
                <code className={cn(ONE_LINE, "min-w-0 flex-1 font-mono text-sm text-fg-secondary [--scroll-bg:var(--well)]")}>
                  {`eins-agent --enroll ${token}`}
                </code>
                <CopyButton value={`eins-agent --enroll ${token}`} label="Befehl für die Installation kopieren" />
              </div>
              <p className="text-sm font-medium leading-5 text-fg-primary">Dieser Code wird nur jetzt angezeigt.</p>
            </>
          ) : (
            <p className="text-sm leading-5 text-fg-secondary">{canIssue ? ONCE : OWNER_ONLY}</p>
          )}
        </div>
      </CardBody>
      <CardFoot>
        <Button className={PRIMARY_BUTTON} onClick={generate} disabled={busy} aria-busy={busy}>
          Einrichtungs-Code erzeugen
        </Button>
      </CardFoot>
    </>
  );
}
