/** The fixed texts of the n8n page, shared with `loading.tsx`. */

// Code in a sentence: the mono face alone, no grey box tight around it, and
// never broken inside ("sha256=" and "<hex>" on two lines reads as two values).
const CODE = "whitespace-nowrap font-mono text-sm";

export const N8N_STEPS = [
  "Erzeugen Sie unten einen geheimen Schlüssel (HMAC-Secret). Er beweist dem Portal, dass die Daten wirklich von Ihrer Praxis kommen.",
  <>
    Laden Sie unsere n8n-Vorlage herunter:{" "}
    <a
      href="/pvs-bridge/n8n-templates/canonical-emitter.json"
      download
      className="rounded-[var(--r-small)] font-medium underline decoration-fg-tertiary underline-offset-4 hover:decoration-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      canonical-emitter.json
    </a>
  </>,
  "In Ihrer n8n-Instanz: Workflow importieren, den HTTP-Trigger durch Ihren PVS-spezifischen Trigger ersetzen (Polling, Webhook, ...), den geheimen Schlüssel und Ihre Praxis-Kennung (siehe unten) in die Zugangsdaten eintragen.",
  <>
    Aktivieren. Die Meldungen gehen an <code className={CODE}>POST /api/pvs/events</code> mit HMAC-Signatur.
  </>,
];

export const SECRET_ONCE =
  "Wird nur einmal angezeigt. Bei Verlust einfach einen neuen erzeugen, der alte gilt dann sofort nicht mehr.";

/** In the empty well for roles without `settings.integrations` (the action refuses them). */
export const SECRET_OWNER_ONLY = "Nur die Rolle Inhaber kann einen Schlüssel erzeugen.";

export const SECRET_HOW = (
  <>
    In n8n eintragen als „X-EINS-Signature“-HMAC-Key, Algorithmus SHA-256, ausgegeben als{" "}
    <code className={CODE}>sha256=&lt;hex&gt;</code>.
  </>
);

/** Height of the key well in every state: padding, the key at control height, the sentence under it. */
export const SECRET_WELL = "h-[calc(var(--control-h)+3.25rem)]";
