"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { getStorage } from "@/server/storage";

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
const ALLOWED_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/png",
]);

function extensionFor(mime: string): "webp" | "jpg" | "png" {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "webp";
}

export async function uploadOwnAvatarAction(formData: FormData) {
  const session = await requireSession();

  const file = formData.get("avatar");
  if (!(file instanceof File)) {
    throw new Error("Keine Datei empfangen.");
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Nur WebP-, JPEG- oder PNG-Bilder werden akzeptiert.");
  }
  if (file.size === 0) {
    throw new Error("Datei ist leer.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Bild ist zu groß (max. 2 MB).");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = extensionFor(file.type);
  const newKey = `avatars/${session.userId}.${ext}`;

  // If the user previously uploaded under a different extension (e.g.
  // switched from PNG to WebP), the old object would otherwise linger.
  const [existing] = await db
    .select({ avatarKey: schema.clinicUsers.avatarKey })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, session.userId))
    .limit(1);

  const storage = getStorage();
  await storage.put(newKey, buffer, { contentType: file.type });

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

  // Avatars surface on virtually every authenticated route — revalidate the
  // top-level page groups so the new picture appears without a hard reload.
  revalidatePath("/einstellungen");
  revalidatePath("/dashboard");
  revalidatePath("/anfragen");
}

export async function removeOwnAvatarAction() {
  const session = await requireSession();

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

  revalidatePath("/einstellungen");
  revalidatePath("/dashboard");
  revalidatePath("/anfragen");
}
