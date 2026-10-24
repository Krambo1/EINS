import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { kpiSummaryAdmin } from "@/server/queries/kpis";
import { renderEmailLayout, escapeHtml } from "@/server/email";
import { sendEmailOnce } from "@/server/email-once";
import { isYearMonth, previousBerlinMonth } from "./berlin-days";
import { env } from "@/lib/env";
import type { CurrencyCode } from "@/lib/formatting";
import { berlinMidnight } from "@/lib/werkstunden";
import { responseCountsForPeriod } from "@/server/queries/response-time";

/**
 * Monthly clinic report. Generates a PDF, stores it as a document, and emails
 * the Inhaber with a portal link.
 *
 * The actual PDF generation lives in `@/server/reports/monthly-pdf.ts` (part of
 * the "Extras" task). This processor does:
 *   1. pull KPI summary for the period
 *   2. call the PDF builder (lazy import — keeps dev boot fast)
 *   3. write the bytes to storage + insert a document row
 *   4. send the notification email
 */

export interface MonthlyReportJob {
  clinicId: string;
  /**
   * YYYY-MM — e.g. "2026-03". `AUTO_PREV_PERIOD` ("__autoprev__", sent by the
   * worker's monthly dispatcher) resolves to the previous Berlin calendar month
   * at run time (E-02).
   */
  period: string;
}

export const AUTO_PREV_PERIOD = "__autoprev__";

/** "2026-09" -> "September 2026" for subjects and titles (E-26). */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, 15)));
}

export type MonthlyReportResult = "created" | "mailed_only" | "skipped";

/**
 * Idempotent: the PDF/document is built only when no document row exists for
 * the period; the owner mails go through the email_send_log ledger, so a
 * re-run (cron next day, worker after cron, pg-boss retry) never mails twice
 * and only retries recipients whose send failed.
 */
export async function processMonthlyReport(job: MonthlyReportJob): Promise<void> {
  await runMonthlyReport(job);
}

export async function runMonthlyReport(
  job: MonthlyReportJob
): Promise<MonthlyReportResult> {
  const { clinicId } = job;
  const period =
    job.period === AUTO_PREV_PERIOD ? previousBerlinMonth() : job.period;
  if (!isYearMonth(period)) {
    // Throw (not return): a silent "success" hid E-02 for months.
    throw new Error(`[monthly-report] invalid period ${job.period}`);
  }
  const [y, m] = period.split("-").map((x) => Number(x)) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const label = periodLabel(period);

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) {
    console.error(`[monthly-report] clinic ${clinicId} not found`);
    return "skipped";
  }
  // A Praxis created after the period ended has nothing to report for it
  // (otherwise onboarding in October would mail an empty September report).
  if (clinic.createdAt >= berlinMidnight(`${nextMonth}-01`)) {
    return "skipped";
  }

  const storageKey = `${clinicId}/reports/${period}.pdf`;
  const [existingDoc] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.clinicId, clinicId),
        eq(schema.documents.kind, "auswertung_monatlich"),
        eq(schema.documents.storageKey, storageKey)
      )
    )
    .limit(1);

  if (!existingDoc) {
    await buildReport({ clinicId, clinic, period, label, from, to, nextMonth, storageKey });
  }

  await mailOwners({ clinicId, period, label });
  return existingDoc ? "mailed_only" : "created";
}

async function buildReport(args: {
  clinicId: string;
  clinic: typeof schema.clinics.$inferSelect;
  period: string;
  label: string;
  from: Date;
  to: Date;
  nextMonth: string;
  storageKey: string;
}): Promise<void> {
  const { clinicId, clinic, period, label, from, to, nextMonth, storageKey } = args;

  const summary = await kpiSummaryAdmin(clinicId, from, to);

  // Folge 2 of the 48-Werkstunden rule: inquiries of the Berlin calendar
  // month, judged as of now, shown apart from the EINS KPIs above.
  const responseCounts = await responseCountsForPeriod(
    clinicId,
    berlinMidnight(`${period}-01`),
    berlinMidnight(`${nextMonth}-01`),
    new Date()
  );

  // Lazy import so @react-pdf isn't loaded at startup.
  const { renderMonthlyReportPdf } = await import("@/server/reports/monthly-pdf");
  const pdfBuffer = await renderMonthlyReportPdf({
    clinicName: clinic.displayName ?? clinic.legalName,
    period,
    summary,
    currency: clinic.currency as CurrencyCode,
    responseCounts,
  });

  const { getStorage } = await import("@/server/storage");
  const storage = getStorage();
  await storage.put(storageKey, pdfBuffer, { contentType: "application/pdf" });

  // Insert the document row last: it is the "report exists" marker, so a
  // crash before this point simply rebuilds on the next run.
  await db.insert(schema.documents).values({
    clinicId,
    kind: "auswertung_monatlich",
    title: `Monats-Auswertung ${label}`,
    storageKey,
    fileSizeBytes: pdfBuffer.byteLength,
    visibleToRoles: ["inhaber", "marketing"],
  });
}

async function mailOwners(args: {
  clinicId: string;
  period: string;
  label: string;
}): Promise<void> {
  const { clinicId, period, label } = args;

  // Everyone who can see the document (inhaber + marketing), active only.
  const recipients = await db
    .select({
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
    })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.clinicId, clinicId),
        inArray(schema.clinicUsers.role, ["inhaber", "marketing"]),
        isNull(schema.clinicUsers.archivedAt)
      )
    );

  const link = `${env.APP_ORIGIN}/dokumente`;
  let failed = 0;
  for (const u of recipients) {
    // One failing address must not block the others; failures are rethrown
    // at the end so the job/cron step reports them and the next run retries
    // exactly those recipients (the ledger skips the ones already sent).
    try {
      const subject = `EINS · Ihre Monats-Auswertung ${label}`;
      const greeting = u.fullName ? `Guten Tag ${u.fullName},` : "Guten Tag,";
      const html = renderEmailLayout({
        preheader: `Ihre Monats-Auswertung für ${label} liegt im Portal bereit.`,
        heading: `Ihre Auswertung für ${label} ist bereit`,
        introHtml:
          `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 12px 0; letter-spacing:0.012em;">${escapeHtml(greeting)}</p>` +
          `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 28px 0; letter-spacing:0.012em;">Ihre Monats-Auswertung für <strong style="color:#10101a;">${escapeHtml(label)}</strong> liegt im Portal bereit. Sie finden den Bericht unter Dokumente.</p>`,
        cta: { label: "Zur Auswertung", url: link },
        auditRows: [
          { label: "Zeitraum", value: label },
          { label: "Format", value: "PDF" },
        ],
        fallbackUrl: link,
      });
      const result = await sendEmailOnce({
        key: `monthly-report/${clinicId}/${period}/${u.email.toLowerCase()}`,
        clinicId,
        klass: "transactional",
        to: u.email,
        subject,
        text:
          `${greeting}\n\n` +
          `Ihre Monats-Auswertung für ${label} liegt im Portal bereit.\n\n` +
          `Zur Auswertung: ${link}\n\n` +
          `Herzliche Grüße\nEINS`,
        html,
      });
      if (result === "suppressed") {
        console.log(`[monthly-report] clinic=${clinicId} recipient suppressed, skipped`);
      }
    } catch (err) {
      failed++;
      console.error(
        `[monthly-report] send failed clinic=${clinicId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  if (failed > 0) {
    throw new Error(`[monthly-report] ${failed} owner mail(s) failed for clinic=${clinicId}`);
  }
}
