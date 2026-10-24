"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { getStorage } from "@/server/storage";
import { sniffImageType } from "./_image-type";

/**
 * Avatar upload pipeline.
 *
 * The client already cropped the image to a square and re-encoded it as
 * WebP at ~512×512 (see AvatarUploader.tsx). We re-validate type and size
 * server-side, write to the storage adapter under `avatars/<userId>.<ext>`,
 * and persist ONLY the storage key + a fresh `avatar_updated_at` timestamp.
 *
 * The browser-fetchable URL is computed at render time from these two
 * columns (see `server/avatars.ts`), so the DB never holds a CDN domain
 * and `?v=<ts>` cache-busting works without us having to rewrite rows.
 *
 * We deliberately overwrite the same storage key on each upload (no
 * accumulation of old objects) — the timestamp column is what tells the
 * browser to re-fetch.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — generous for a 512×512 WebP

/**
 * Result instead of a thrown Error: a thrown message is replaced by Next's
 * English production text before it reaches the uploader (F-02 / B-16).
 */
export type AvatarActionResult = { ok: true } | { ok: false; error: string };

const UPLOAD_FAILED = "Das Bild konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.";

export async function uploadOwnAvatarAction(formData: FormData): Promise<AvatarActionResult> {
  const session = await requireSession();

  const file = formData.get("avatar");
  if (!(file instanceof File)) {
    return { ok: false, error: "Keine Datei empfangen." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Die Datei ist leer." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Das Bild ist zu groß (max. 2 MB)." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // B-16: the stored type comes from the file's bytes, never from the
  // client-supplied File.type, so a renamed SVG/HTML file cannot be stored
  // and later served under an image content type.
  const sniffed = sniffImageType(buffer);
  if (!sniffed) {
    return { ok: false, error: "Nur WebP-, JPEG- oder PNG-Bilder werden akzeptiert." };
  }
  const newKey = `avatars/${session.userId}.${sniffed.ext}`;

  try {
    // If the user previously uploaded under a different extension (e.g.
    // switched from PNG to WebP), the old object would otherwise linger.
    const [existing] = await db
      .select({ avatarKey: schema.clinicUsers.avatarKey })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, session.userId))
      .limit(1);

    const storage = getStorage();
    await storage.put(newKey, buffer, { contentType: sniffed.mime });

    if (existing?.avatarKey && existing.avatarKey !== newKey) {
      try {
        await storage.remove(existing.avatarKey);
      } catch {
        // Idempotent — a leftover object is harmless.
      }
    }

    await db
      .update(schema.clinicUsers)
      .set({ avatarKey: newKey, avatarUpdatedAt: new Date() })
      .where(eq(schema.clinicUsers.id, session.userId));

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "clinic_user",
      entityId: session.userId,
      diff: { avatarKey: "<set>" },
    });
  } catch (err) {
    console.error("[avatar] upload failed", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return { ok: false, error: UPLOAD_FAILED };
  }

  // Avatars surface on virtually every authenticated route — revalidate the
  // top-level page groups so the new picture appears without a hard reload.
  revalidatePath("/einstellungen");
  revalidatePath("/dashboard");
  revalidatePath("/anfragen");
  return { ok: true };
}

export async function removeOwnAvatarAction(): Promise<AvatarActionResult> {
  const session = await requireSession();

  try {
    const [me] = await db
      .select({ avatarKey: schema.clinicUsers.avatarKey })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, session.userId))
      .limit(1);

    if (me?.avatarKey) {
      try {
        await getStorage().remove(me.avatarKey);
      } catch {
        // Idempotent: leftover object is harmless.
      }
    }

    await db
      .update(schema.clinicUsers)
      .set({ avatarKey: null, avatarUpdatedAt: null })
      .where(eq(schema.clinicUsers.id, session.userId));

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "update",
      entityKind: "clinic_user",
      entityId: session.userId,
      diff: { avatarKey: null },
    });
  } catch (err) {
    console.error("[avatar] remove failed", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return { ok: false, error: "Das Bild konnte nicht entfernt werden. Bitte versuchen Sie es erneut." };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/dashboard");
  revalidatePath("/anfragen");
  return { ok: true };
}
