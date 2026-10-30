import "server-only";
import { escapeHtml, getEmailSender, renderEmailLayout, type EmailSender } from "@/server/email";
import type { StepResult } from "./run";

/**
 * Mail to the EINS team when a deletion step of /api/cron/daily fails.
 * Without it a failed purge only shows in the JSON summary nobody reads, and
 * the retention periods (lib/retention.ts) silently stop being kept.
 *
 * One mail per run, listing every failed deletion step. Content: step name,
 * what it deletes, the error text. No patient data: the error text is
 * scrubbed of e-mail addresses, phone-like numbers and Postgres key values
 * before it leaves the server.
 */

export const DELETION_ALERT_TO = "team@eins.ag";

/** Deletion steps of the daily run and what each one removes. */
export const DELETION_STEPS: Record<string, string> = {
  "purge-retention":
    "Aufbewahrungsfristen: Spam, Klick-IDs, archivierte Praxen, alte Anfragen ohne Termin, Sitzungen, Tokens, Versandprotokoll",
  "purge-audit": "Audit-Protokoll und abgelaufene Token- und Rate-Limit-Einträge (sonntags)",
};

/** Failed deletion steps of a run, in run order. */
export function deletionFailures(results: readonly StepResult[]): StepResult[] {
  return results.filter((r) => !r.ok && r.step in DELETION_STEPS);
}

/**
 * Error text without anything that could identify a person: e-mail
 * addresses, phone-like digit runs and Postgres `Key (col)=(value)` values.
 */
export function scrubErrorText(text: string): string {
  return text
    .replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g, "[E-Mail]")
    .replace(/=\([^)]*\)/g, "=([…])")
    .replace(/(?<![0-9a-fA-F-])\+?\d[\d /]{5,}\d(?![0-9a-fA-F])/g, "[Zahl]");
}

const berlinStamp = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function deletionAlertEmail(
  failures: readonly StepResult[],
  now: Date
): { subject: string; text: string; html: string } {
  const when = `${berlinStamp.format(now)} Uhr (Berlin)`;
  const lines = failures.map((f) => ({
    step: f.step,
    what: DELETION_STEPS[f.step] ?? "",
    error: scrubErrorText(f.error ?? "unbekannter Fehler"),
  }));
  const subject =
    lines.length === 1
      ? `Löschlauf fehlgeschlagen: ${lines[0]!.step}`
      : `Löschlauf fehlgeschlagen: ${lines.length} Schritte`;
  const intro = `Der tägliche Lauf /api/cron/daily am ${when} hat nicht alles gelöscht, was die Aufbewahrungsfristen verlangen.`;
  const outro = [
    "Der nächste Lauf versucht es automatisch erneut. Bleibt der Fehler bestehen, liegen diese Daten länger als vorgesehen.",
    "Details: Vercel-Logs, Eintrag cron daily.",
  ];

  const text = [
    intro,
    "",
    "Fehlgeschlagene Schritte:",
    ...lines.map((l) => `- ${l.step} (${l.what}): ${l.error}`),
    "",
    ...outro,
    "",
    "Diese E-Mail enthält keine Patientendaten.",
  ].join("\n");

  const listHtml = `<ul style="margin:0 0 24px 0; padding-left:20px; color:#10101a; font-size:15px; line-height:1.7;">${lines
    .map(
      (l) =>
        `<li><strong>${escapeHtml(l.step)}</strong> <span style="color:#6a6a74;">(${escapeHtml(l.what)})</span><br>${escapeHtml(l.error)}</li>`
    )
    .join("")}</ul>`;
  const html = renderEmailLayout({
    preheader: subject,
    heading: "Löschlauf fehlgeschlagen",
    introHtml: `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 20px 0;">${escapeHtml(intro)}</p>`,
    customBlockHtml:
      listHtml +
      outro
        .map((p) => `<p style="font-size:15px; line-height:1.55; color:#4a4a52; margin:0 0 12px 0;">${escapeHtml(p)}</p>`)
        .join(""),
    auditRows: [
      { label: "Lauf", value: "cron daily" },
      { label: "Zeit", value: when },
    ],
    footerLines: [
      "Interne Benachrichtigung · EINS Portal",
      "Diese E-Mail enthält keine Patientendaten.",
    ],
  });
  return { subject, text, html };
}

/**
 * Send one alert for the failed deletion steps of a finished run. Returns the
 * step result to record, or null when no deletion step failed. Never throws:
 * a failing mail must not turn the cron answer into a 500.
 */
export async function mailDeletionFailures(
  results: readonly StepResult[],
  opts: { sender?: EmailSender; now?: Date } = {}
): Promise<StepResult | null> {
  const failures = deletionFailures(results);
  if (failures.length === 0) return null;
  const t0 = Date.now();
  const step = "deletion-failure-mail";
  try {
    const mail = deletionAlertEmail(failures, opts.now ?? new Date());
    await (opts.sender ?? getEmailSender()).send({ to: DELETION_ALERT_TO, ...mail });
    return { step, ok: true, ms: Date.now() - t0, detail: { steps: failures.map((f) => f.step) } };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    return { step, ok: false, ms: Date.now() - t0, error };
  }
}
