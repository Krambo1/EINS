import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { kpiSummaryAdmin, type KpiSummary } from "@/server/queries/kpis";
import { renderEmailLayout, escapeHtml } from "@/server/email";
import { sendEmailOnce } from "@/server/email-once";
import { isYearMonth, previousBerlinMonth } from "./berlin-days";
import { env } from "@/lib/env";
import { dashboardRangeWindow, type DashboardWindow } from "@/lib/dashboard-range";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatRoas,
  type CurrencyCode,
} from "@/lib/formatting";
import { berlinMidnight } from "@/lib/werkstunden";

/**
 * Monthly mail to the Praxis. The portal is the monthly Auswertung (contract
 * 2.11: "Auswertung im Portal"), so there is no PDF and no document: the mail
 * carries the Kennzahlen the Übersicht shows for "30 Tage" on the day it is
 * sent, and a button to the Übersicht. The next steps agreed in the
 * Strategie-Gespräch are a Fortschritt entry (admin, Praxis detail).
 */

export interface MonthlyReportJob {
  clinicId: string;
  /**
   * YYYY-MM — e.g. "2026-03". `AUTO_PREV_PERIOD` ("__autoprev__", sent by the
   * worker's monthly dispatcher) resolves to the previous Berlin calendar month
   * at run time (E-02). Only keys the mail (one per month and recipient); the
   * figures are always the Übersicht's 30 Tage.
   */
  period: string;
}

export const AUTO_PREV_PERIOD = "__autoprev__";

/** sent: at least one mail went out; already_sent: every recipient had it. */
export type MonthlyReportResult = "sent" | "already_sent" | "skipped";

/**
 * Idempotent: the owner mails go through the email_send_log ledger, so a
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
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;

  const [clinic] = await db
    .select({ createdAt: schema.clinics.createdAt, currency: schema.clinics.currency })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) {
    console.error(`[monthly-report] clinic ${clinicId} not found`);
    return "skipped";
  }
  // A Praxis created after the period ended had no month with EINS yet
  // (otherwise onboarding in October would mail on 1 October already).
  if (clinic.createdAt >= berlinMidnight(`${nextMonth}-01`)) {
    return "skipped";
  }

  // The Übersicht's default period as it stands today, so the figures in the
  // mail are the ones the button opens.
  const win = dashboardRangeWindow("mon");
  const summary = await kpiSummaryAdmin(clinicId, win.from, win.to);

  const sent = await mailOwners({
    clinicId,
    period,
    win,
    summary,
    currency: clinic.currency as CurrencyCode,
  });
  return sent > 0 ? "sent" : "already_sent";
}

/** Label and value rows of the mail, in the order of the Übersicht. */
export function monthlyMailRows(
  win: Pick<DashboardWindow, "from" | "to">,
  summary: KpiSummary,
  currency: CurrencyCode
): Array<{ label: string; value: string }> {
  const rows = [
    { label: "Zeitraum", value: `${formatDate(win.from)} bis ${formatDate(win.to)}` },
    { label: "Anfragen", value: formatNumber(summary.leads) },
    { label: "Termine", value: formatNumber(summary.appointments) },
    { label: "Behandlungen gewonnen", value: formatNumber(summary.casesWon) },
    { label: "Umsatz", value: formatMoney(summary.revenueEur, currency) },
  ];
  // Werbeertrag and Kosten pro qualifizierter Anfrage only once Werbebudget
  // ran, as on the Übersicht.
  if (summary.roas !== null) {
    rows.push({ label: "Werbeertrag", value: formatRoas(summary.roas) });
  }
  if (summary.costPerQualifiedLead !== null) {
    rows.push({
      label: "Kosten pro qualifizierter Anfrage",
      value: formatMoney(summary.costPerQualifiedLead, currency),
    });
  }
  return rows;
}

async function mailOwners(args: {
  clinicId: string;
  period: string;
  win: DashboardWindow;
  summary: KpiSummary;
  currency: CurrencyCode;
}): Promise<number> {
  const { clinicId, period, win, summary, currency } = args;

  // Inhaber and Marketing, active only: the people who sit in the
  // Strategie-Gespräch.
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

  const link = `${env.APP_ORIGIN}/dashboard`;
  const rows = monthlyMailRows(win, summary, currency);
  const leads = formatNumber(summary.leads);
  const won = formatNumber(summary.casesWon);
  let sent = 0;
  let failed = 0;
  for (const u of recipients) {
    // One failing address must not block the others; failures are rethrown
    // at the end so the job/cron step reports them and the next run retries
    // exactly those recipients (the ledger skips the ones already sent).
    try {
      const greeting = u.fullName ? `Guten Tag ${u.fullName},` : "Guten Tag,";
      const html = renderEmailLayout({
        preheader: `${leads} Anfragen, ${won} Behandlungen gewonnen. Alle Zahlen in Ihrer Übersicht.`,
        heading: "Ihre Zahlen der letzten 30 Tage",
        introHtml:
          `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 12px 0; letter-spacing:0.012em;">${escapeHtml(greeting)}</p>` +
          `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 28px 0; letter-spacing:0.012em;">Woher Ihre Anfragen kamen und was daraus wurde, sehen Sie in Ihrer Übersicht im Portal. Im nächsten Strategie-Gespräch besprechen wir die Zahlen gemeinsam.</p>`,
        cta: { label: "Zur Übersicht", url: link },
        auditRows: rows,
        fallbackUrl: link,
      });
      const result = await sendEmailOnce({
        key: `monthly-report/${clinicId}/${period}/${u.email.toLowerCase()}`,
        clinicId,
        klass: "transactional",
        to: u.email,
        subject: "EINS · Ihre Zahlen der letzten 30 Tage",
        text:
          `${greeting}\n\n` +
          `Ihre Zahlen der letzten 30 Tage:\n` +
          rows.map((r) => `${r.label}: ${r.value}`).join("\n") +
          `\n\nWoher Ihre Anfragen kamen und was daraus wurde, sehen Sie in Ihrer Übersicht im Portal: ${link}\n\n` +
          `Im nächsten Strategie-Gespräch besprechen wir die Zahlen gemeinsam.\n\n` +
          `Herzliche Grüße\nEINS`,
        html,
      });
      if (result === "sent") sent++;
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
  return sent;
}
