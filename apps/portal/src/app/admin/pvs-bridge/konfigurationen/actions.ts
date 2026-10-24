"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { writeAudit } from "@/server/audit";
import {
  pinClinic,
  publishBundle,
  revokeConfig,
  setRolloutMode,
  unpinClinic,
  ROLLOUT_MODES,
} from "@/server/pvs-vendor-config";

/**
 * Admin actions for vendor-config distribution.
 *
 * Every one of these can change what SQL runs against a Praxis patient
 * database, so all of them re-check admin and write an audit row. None of them
 * can create a config: signing happens offline and this app only ever verifies
 * (see server/pvs-vendor-config.ts).
 */

const PATH = "/admin/pvs-bridge/konfigurationen";

/** Server actions return a message the page renders; they never throw at the user. */
export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function publishConfigAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const file = formData.get("bundleFile");
  const pasted = formData.get("bundleText");

  let raw: string | null = null;
  if (file instanceof File && file.size > 0) {
    // A signed bundle is a small JSON document; anything past a megabyte is not
    // one, and reading it would just be work before the same rejection.
    if (file.size > 1_000_000) {
      return { ok: false, message: "Die Datei ist zu groß für ein Konfigurations-Paket." };
    }
    raw = await file.text();
  } else if (typeof pasted === "string" && pasted.trim().length > 0) {
    raw = pasted;
  }
  if (!raw) {
    return {
      ok: false,
      message: "Bitte wählen Sie eine signierte .json-Datei aus oder fügen Sie deren Inhalt ein.",
    };
  }

  const result = await publishBundle(raw, admin.email);
  if (!result.ok) return { ok: false, message: result.reason };

  await writeAudit({
    actorEmail: admin.email,
    action: "create",
    entityKind: "pvs_vendor_config",
    entityId: result.id,
    diff: { vendor: result.vendor, version: result.version },
  });

  revalidatePath(PATH);
  return {
    ok: true,
    message: `${result.vendor} Version ${result.version} ist hinterlegt. Sie erreicht noch keine Praxis: setzen Sie unten die Verteilung auf Pilot oder Alle.`,
  };
}

const RolloutSchema = z.object({
  configId: z.string().uuid(),
  mode: z.enum(ROLLOUT_MODES),
});

export async function setRolloutAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = RolloutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  await setRolloutMode(parsed.data.configId, parsed.data.mode);
  await writeAudit({
    actorEmail: admin.email,
    action: "update",
    entityKind: "pvs_vendor_config",
    entityId: parsed.data.configId,
    diff: { rolloutMode: parsed.data.mode },
  });
  revalidatePath(PATH);
}

export async function revokeConfigAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const configId = z.string().uuid().safeParse(formData.get("configId"));
  if (!configId.success) return;

  await revokeConfig(configId.data);
  await writeAudit({
    actorEmail: admin.email,
    action: "update",
    entityKind: "pvs_vendor_config",
    entityId: configId.data,
    diff: { status: "revoked" },
  });
  revalidatePath(PATH);
}

const PinSchema = z.object({
  clinicId: z.string().uuid(),
  configId: z.string().uuid(),
});

export async function pinClinicAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = PinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const result = await pinClinic(
    parsed.data.clinicId,
    parsed.data.configId,
    admin.email
  );
  if (!result.ok) return;

  await writeAudit({
    clinicId: parsed.data.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "pvs_vendor_config_target",
    entityId: parsed.data.configId,
    diff: { pinned: true },
  });
  revalidatePath(PATH);
}

const UnpinSchema = z.object({
  clinicId: z.string().uuid(),
  vendor: z.string().min(1).max(64),
});

export async function unpinClinicAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = UnpinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  await unpinClinic(parsed.data.clinicId, parsed.data.vendor);
  await writeAudit({
    clinicId: parsed.data.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "pvs_vendor_config_target",
    diff: { vendor: parsed.data.vendor, pinned: false },
  });
  revalidatePath(PATH);
}
