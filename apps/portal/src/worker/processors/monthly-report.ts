import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { kpiSummaryAdmin } from "@/server/queries/kpis";
import { getEmailSender, renderEmailLayout, escapeHtml } from "@/server/email";
import { isEmailSuppressed } from "@/server/email-suppression";
import { env } from "@/lib/env";
import type { CurrencyCode } from "@/lib/formatting";

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
  /** YYYY-MM — e.g. "2026-03". */
  period: string;
}

export async function processMonthlyReport(job: MonthlyReportJob): Promise<void> {
  const { clinicId, period } = job;

  const [y, m] = period.split("-").map((x) => Number(x));
  if (!y || !m) {
    console.error(`[monthly-report] invalid period ${period}`);
    return;
  }
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) {
    console.error(`[monthly-report] clinic ${clinicId} not found`);
    return;
  }

  const summary = await kpiSummaryAdmin(clinicId, from, to);

  // Lazy import so @react-pdf isn't loaded at startup.
  const { renderMonthlyReportPdf } = await import("@/server/reports/monthly-pdf");
  const pdfBuffer = await renderMonthlyReportPdf({
    clinicName: clinic.displayName ?? clinic.legalName,
    period,
    summary,
    currency: clinic.currency as CurrencyCode,
  });

  const { getStorage } = await import("@/server/storage");
  const storage = getStorage();
  const storageKey = `${clinicId}/reports/${period}.pdf`;
  await storage.put(storageKey, pdfBuffer, { contentType: "application/pdf" });

  // Find or create a document row.
  const [existing] = await db
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

  if (!existing) {
    await db.insert(schema.documents).values({
      clinicId,
      kind: "auswertung_monatlich",
      title: `Monats-Auswertung ${period}`,
      storageKey,
      fileSizeBytes: pdfBuffer.byteLength,
      visibleToRoles: ["inhaber", "marketing"],
    });
  }

  // Email notification to inhaber(s).
  const inhaber = await db
    .select({
      email: schema.clinicUsers.email,
      fullName: schema.clinicUsers.fullName,
    })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.clinicId, clinicId),
        eq(schema.clinicUsers.role, "inhaber")
      )
    );

  const link = `${env.APP_ORIGIN}/dokumente`;
  const sender = getEmailSender();
  for (const u of inhaber) {
    // Suppression — check per-recipient. A single dead inhaber address
    // shouldn't break the whole batch. Try/catch so one Resend 5xx also
    // doesn't blow up subsequent sends (the original code threw on the
    // first failure and pg-boss replayed → duplicate PDFs).
    try {
      const reason = await isEmailSuppressed(clinicId, u.email, "transactional");
      if (reason) {
        console.log(
          `[monthly-report] skipping to=${u.email} clinic=${clinicId} reason=${reason}`
        );
        continue;
      }
      const subject = `EINS · Monats-Auswertung ${period}`;
      const greeting = u.fullName ? `Guten Tag ${u.fullName},` : "Guten Tag,";
      const html = renderEmailLayout({
        preheader: `Ihre Monats-Auswertung für ${period} liegt im Portal bereit.`,
        heading: `Ihre Auswertung für ${period} ist bereit`,
        introHtml:
          `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 12px 0; letter-spacing:0.012em;">${escapeHtml(greeting)}</p>` +
          `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 28px 0; letter-spacing:0.012em;">Ihre Monats-Auswertung für <strong style="color:#10101a;">${escapeHtml(period)}</strong> liegt im Portal bereit. Sie finden den Bericht unter Dokumente.</p>`,
        cta: { label: "Zur Auswertung", url: link },
        auditRows: [
          { label: "Zeitraum", value: period },
          { label: "Format", value: "PDF" },
        ],
        fallbackUrl: link,
      });
      await sender.send({
        to: u.email,
        subject,
        text:
          `${greeting}\n\n` +
          `Ihre Monats-Auswertung für ${period} liegt im Portal bereit.\n\n` +
          `Zur Auswertung: ${link}\n\n` +
          `Herzliche Grüße\nEINS`,
        html,
      });
    } catch (err) {
      console.error(
        `[monthly-report] send to ${u.email} clinic ${clinicId} failed:`,
        err
      );
      // continue — the document is already in storage; partial-batch
      // failure shouldn't bounce the whole job to pg-boss and re-render
      // the PDF on retry.
    }
  }
}
