/** A form field an error can name (the form's field names). */
export type ManualEntryField = "contactName" | "contactPhone" | "contactEmail" | "treatmentId" | "selfReportedSource";

/**
 * The fields behind each message `createManualRequestAction` returns: the
 * messages of ManualEntrySchema (`lib/manual-entry.ts`) and of
 * UnknownTreatmentError (`server/manual-entry.ts`). The action only returns
 * the message; a message missing here rings no field and is still shown in
 * full in the toast.
 */
const FIELDS_OF_MESSAGE: Record<string, ManualEntryField[]> = {
  "Bitte geben Sie den Namen an.": ["contactName"],
  "Der Name ist zu lang.": ["contactName"],
  "Bitte prüfen Sie die Telefonnummer.": ["contactPhone"],
  "Bitte prüfen Sie die E-Mail-Adresse.": ["contactEmail"],
  "Bitte geben Sie eine Telefonnummer oder eine E-Mail-Adresse an.": ["contactPhone", "contactEmail"],
  "Bitte wählen Sie eine Behandlung aus der Liste.": ["treatmentId"],
  "Diese Behandlung gibt es in Ihrer Praxis nicht mehr. Bitte wählen Sie neu.": ["treatmentId"],
  "Bitte wählen Sie aus, wie die Person zu Ihnen kam.": ["selfReportedSource"],
};

export function fieldsOf(message: string): ManualEntryField[] {
  return FIELDS_OF_MESSAGE[message] ?? [];
}
