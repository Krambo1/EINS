import { z } from "zod";
import { SELF_REPORTED_SOURCES, type SelfReportedSource } from "@/lib/sources";
import type { LeadInput } from "@/server/leads";

/**
 * "Anfrage anlegen" at the Empfang: a person called the Praxis or walked in.
 *
 * Source `manuell`, so attribution confidence "praxis_eingabe" and never an
 * EINS-Messweg: such an Anfrage can never trigger the first invoice (KANON
 * § 5). No free-text field on purpose: a note can carry health data, and the
 * Anfrage page already has "Notiz" for whatever the team must write down.
 *
 * Pure module (no DB), so the form parsing and the persistLead mapping are
 * unit-testable.
 */

/** Same person within this many days: an activity on the existing Anfrage (KANON § 5). */
export const MANUAL_ENTRY_SAME_CONTACT_DAYS = 30;

export const MANUAL_ENTRY_REPEAT_BODY = "Dieselbe Person wurde erneut am Empfang erfasst.";

/** Form value for "Noch offen" in the treatment select (Radix allows no empty value). */
export const TREATMENT_OPEN = "offen";

export const MANUAL_ENTRY_REPEAT_NOTICE =
  "Diese Person hat in den letzten 30 Tagen schon angefragt. Der Eintrag wurde dort ergänzt.";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const ManualEntrySchema = z
  .object({
    contactName: z
      .string({ required_error: "Bitte geben Sie den Namen an." })
      .trim()
      .min(1, "Bitte geben Sie den Namen an.")
      .max(200, "Der Name ist zu lang."),
    contactPhone: optionalText(64).refine(
      (v) => v === null || v.replace(/\D/g, "").length >= 6,
      "Bitte prüfen Sie die Telefonnummer."
    ),
    contactEmail: optionalText(254).refine(
      (v) => v === null || z.string().email().safeParse(v).success,
      "Bitte prüfen Sie die E-Mail-Adresse."
    ),
    /** Empty = "Noch offen". Must belong to the Praxis (checked on the server). */
    treatmentId: optionalText(64).refine(
      (v) => v === null || z.string().uuid().safeParse(v).success,
      "Bitte wählen Sie eine Behandlung aus der Liste."
    ),
    selfReportedSource: z.enum(SELF_REPORTED_SOURCES, {
      errorMap: () => ({ message: "Bitte wählen Sie aus, wie die Person zu Ihnen kam." }),
    }),
  })
  .refine((v) => v.contactPhone !== null || v.contactEmail !== null, {
    message: "Bitte geben Sie eine Telefonnummer oder eine E-Mail-Adresse an.",
    path: ["contactPhone"],
  });

export type ManualEntry = z.infer<typeof ManualEntrySchema>;

export type ManualEntryParse =
  | { ok: true; entry: ManualEntry }
  | { ok: false; message: string };

/** Parse the form fields. Unknown keys (a smuggled clinicId, source, utm) are ignored. */
export function parseManualEntry(fields: Record<string, unknown>): ManualEntryParse {
  const parsed = ManualEntrySchema.safeParse({
    contactName: fields.contactName ?? "",
    contactPhone: fields.contactPhone ?? null,
    contactEmail: fields.contactEmail ?? null,
    treatmentId: fields.treatmentId === TREATMENT_OPEN ? null : fields.treatmentId ?? null,
    selfReportedSource: fields.selfReportedSource,
  });
  if (parsed.success) return { ok: true, entry: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues[0]?.message ?? "Bitte prüfen Sie Ihre Eingaben.",
  };
}

/**
 * The persistLead input for one front-desk entry. `treatmentName` is the
 * Praxis's own treatment the id resolved to (null = "Noch offen").
 */
export function manualEntryLeadInput(
  entry: ManualEntry,
  treatmentName: string | null
): LeadInput {
  const selfReportedSource: SelfReportedSource = entry.selfReportedSource;
  return {
    source: "manuell",
    selfReportedSource,
    contactName: entry.contactName,
    contactPhone: entry.contactPhone,
    contactEmail: entry.contactEmail,
    treatmentWish: treatmentName,
    // Same as the Messweg webhooks: no form consent exists. The Praxis
    // records its own patient contact under its own legal basis; there is no
    // consent record and no ads consent, so nothing is ever reported.
    // No form consent at the front desk (leads.ts stores NULL).
    dsgvoConsent: false,
    consents: null,
    utm: null,
    sameContactWithinDays: MANUAL_ENTRY_SAME_CONTACT_DAYS,
    sameContactActivity: {
      body: MANUAL_ENTRY_REPEAT_BODY,
      meta: { entry: "manuell" },
      // A note, not a Messweg: a repeat at the front desk is no EINS channel.
      kind: "note",
    },
  };
}
