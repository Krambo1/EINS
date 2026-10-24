"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/guards";
import { writeAudit } from "@/server/audit";
import { ClinicArchivedError } from "@/server/leads";
import { createManualRequest, UnknownTreatmentError } from "@/server/manual-entry";
import { invalidateClinicKpiCache } from "@/server/queries/_cache";
import { invalidateNavBadges } from "@/server/queries/navBadgesCache";
import { flashSuccess } from "@/lib/flash";
import { can } from "@/lib/roles";
import { MANUAL_ENTRY_REPEAT_NOTICE, parseManualEntry } from "@/lib/manual-entry";

export type ManualEntryState = { kind: "idle" } | { kind: "error"; message: string };

function field(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" ? v : null;
}

/**
 * "Anfrage anlegen" (Empfang). session → requests.update → zod →
 * createManualRequest (persistLead, clinicId from the session only) →
 * writeAudit → revalidate → redirect to the Anfrage.
 */
export async function createManualRequestAction(
  _prev: ManualEntryState | undefined,
  formData: FormData
): Promise<ManualEntryState> {
  const session = await requireSession();
  if (!can(session.role, "requests.update")) {
    return { kind: "error", message: "Dafür fehlt Ihnen die Berechtigung." };
  }

  const parsed = parseManualEntry({
    contactName: field(formData, "contactName"),
    contactPhone: field(formData, "contactPhone"),
    contactEmail: field(formData, "contactEmail"),
    treatmentId: field(formData, "treatmentId"),
    selfReportedSource: field(formData, "selfReportedSource"),
  });
  if (!parsed.ok) return { kind: "error", message: parsed.message };

  let result: Awaited<ReturnType<typeof createManualRequest>>;
  try {
    result = await createManualRequest(session.clinicId, parsed.entry);
  } catch (err) {
    if (err instanceof UnknownTreatmentError) return { kind: "error", message: err.message };
    if (err instanceof ClinicArchivedError) {
      return {
        kind: "error",
        message: "Die Zusammenarbeit ist beendet. Neue Anfragen lassen sich nicht mehr anlegen.",
      };
    }
    console.error(
      "[anfragen/neu] create failed:",
      err instanceof Error ? err.name : "unknown"
    );
    return {
      kind: "error",
      message: "Speichern hat nicht geklappt. Bitte versuchen Sie es noch einmal.",
    };
  }

  const repeat = result.status === "same_contact";
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: repeat ? "update" : "create",
    entityKind: "request",
    entityId: result.id,
    diff: {
      source: "manuell",
      selfReportedSource: parsed.entry.selfReportedSource,
      sameContact: repeat,
    },
  });

  revalidatePath("/anfragen");
  revalidatePath(`/anfragen/${result.id}`);
  void invalidateClinicKpiCache(session.clinicId);
  invalidateNavBadges(session.clinicId, session.userId);

  if (repeat) await flashSuccess("Eintrag ergänzt", MANUAL_ENTRY_REPEAT_NOTICE);
  else await flashSuccess("Anfrage angelegt");

  redirect(`/anfragen/${result.id}`);
}
