import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { kpiSummaryAdmin } from "@/server/queries/kpis";
import { getEmailSender } from "@/server/email";
import { env } from "@/lib/env";

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
    await sender.send({
      to: u.email,
      subject: `Ihre Monats-Auswertung ${period} ist bereit`,
      text:
        `Guten Tag${u.fullName ? " " + u.fullName : ""},\n\n` +
        `Ihre Monats-Auswertung für ${period} liegt im Portal bereit.\n\n` +
        `Zur Auswertung: ${link}\n\n` +
        `Herzliche Grüße\nEINS Visuals`,
      html: `<p>Guten Tag${u.fullName ? " " + u.fullName : ""},</p>
             <p>Ihre Monats-Auswertung für <strong>${period}</strong> liegt im Portal bereit.</p>
             <p><a href="${link}">Zur Auswertung</a></p>
             <p>Herzliche Grüße<br>EINS Visuals</p>`,
    });
  }
}
