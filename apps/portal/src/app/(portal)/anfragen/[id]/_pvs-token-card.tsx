"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { showActionFlash } from "../../_components/flash-event";
import { ROW_ICON_BUTTON } from "./_fact";

/**
 * Direction A, token surfacing for MFA copy-paste: the EINS-Lead-{8hex}
 * token of this request as the value of the record's "PVS" row, with one tap
 * to copy it (Attio's copy on a field) and the instruction behind (i).
 *
 * For write-capable adapters (Tomedo, RED, HealthHub, n8n) the bridge writes
 * the token automatically; the row is the manual fallback for GDT-Agent /
 * CSV-only clinics.
 */
export function PvsCode({ token, pvsVendor }: { token: string; pvsVendor: string | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // Adapters that write the token back on their own: say so, so the MFA
  // doesn't paste it twice.
  const supportsAutoWrite =
    pvsVendor === "tomedo" || pvsVendor === "red" || pvsVendor === "healthhub" || pvsVendor === "n8n_custom";

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      showActionFlash({ tone: "good", title: "Code kopiert", description: token });
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht kopiert",
        description: "Ihr Browser hat das Kopieren nicht erlaubt. Markieren Sie den Code und kopieren Sie ihn selbst.",
      });
    }
  }

  return (
    <span className="flex items-start justify-between gap-2">
      <span className="scroll-shadows-x min-w-0 flex-1 font-mono text-sm leading-5">{token}</span>
      <span className="flex shrink-0 items-center">
        <ExplainerPopover term="PVS-Code" ariaLabel="Erklärung zum PVS-Code">
          {supportsAutoWrite
            ? "EINS hat versucht, diesen Code automatisch in die PVS-Bemerkung zu schreiben. Falls er dort fehlt, fügen Sie ihn beim Anlegen des Patienten selbst ein."
            : "Fügen Sie diesen Code beim Anlegen des Patienten in der PVS in das Bemerkungsfeld ein. So verknüpft EINS den späteren Termin mit dieser Anfrage."}
        </ExplainerPopover>
        <button type="button" onClick={copy} aria-label="Code kopieren" title="Kopieren" className={ROW_ICON_BUTTON}>
          {copied ? <Check className="h-4 w-4 text-tone-good" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        </button>
      </span>
    </span>
  );
}
