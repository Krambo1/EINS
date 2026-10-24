"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { withClinicContext, db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { flashMessageFromError } from "@/lib/flash";
import { escapeHtml, getEmailSender, renderEmailLayout } from "@/server/email";

const NOTE_MAX = 1000;

const Input = z.object({
  libraryId: z.string().uuid(),
  note: z.string().optional(),
});

/** `note` echoes the typed text on failure so the form can keep it (F-01). */
export type RequestCustomizationState =
  | undefined
  | { ok: true }
  | { ok: false; error: string; note: string };

/**
 * Clinic user asks for a customized version of an animation.
 * Creates (or updates) the animation_instance row to state=requested,
 * notifies the EINS team by email. Failures come back as a German message
 * instead of the error page, so the typed note is not lost.
 */
export async function requestAnimationCustomizationAction(
  _prev: RequestCustomizationState,
  formData: FormData
): Promise<RequestCustomizationState> {
  const session = await requireSession();
  const rawNote = String(formData.get("note") ?? "");
  if (!can(session.role, "animations.request_customization")) {
    return {
      ok: false,
      error: flashMessageFromError(new ForbiddenError("animations.request_customization")),
      note: rawNote,
    };
  }
  const parsed = Input.safeParse({
    libraryId: formData.get("libraryId"),
    note: formData.get("note") ?? undefined,
  });
  // Only a tampered form can fail here (hidden uuid); nothing to save.
  if (!parsed.success) {
    return { ok: false, error: "Bitte laden Sie die Seite neu und versuchen Sie es erneut.", note: rawNote };
  }
  // The textarea caps at NOTE_MAX; cut instead of throwing on an old client.
  const note = parsed.data.note?.trim().slice(0, NOTE_MAX) || undefined;
  const input = { libraryId: parsed.data.libraryId, note };

  try {
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      // Single-statement upsert on the unique (clinic_id, library_id): a
      // double click can no longer race two INSERTs into the constraint.
      const now = new Date();
      await tx
        .insert(schema.animationInstances)
        .values({
          clinicId: session.clinicId,
          libraryId: input.libraryId,
          status: "requested",
          requestedBy: session.userId,
          requestedAt: now,
          requestNote: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [
            schema.animationInstances.clinicId,
            schema.animationInstances.libraryId,
          ],
          set: {
            status: "requested",
            requestedBy: session.userId,
            requestedAt: now,
            requestNote: input.note ?? null,
          },
        });
    });

    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "request_animation",
      entityKind: "animation_instance",
      entityId: input.libraryId,
      diff: { note: input.note },
    });
  } catch (err) {
    return {
      ok: false,
      error: flashMessageFromError(err, "medien.request_customization"),
      note: rawNote,
    };
  }

  // Best-effort notification. We don't want a mail failure to block the UI.
  try {
    const [clinic] = await db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1);
    const [library] = await db
      .select({ title: schema.animationLibrary.title })
      .from(schema.animationLibrary)
      .where(eq(schema.animationLibrary.id, input.libraryId))
      .limit(1);
    const clinicLabel = clinic?.displayName ?? session.clinicId;
    const animationLabel = library?.title ?? input.libraryId;
    const subject = `EINS · Animations-Anfrage aus ${clinicLabel}`;
    const text = [
      subject,
      "",
      `Praxis:     ${clinicLabel}`,
      `Nutzer:     ${session.email}`,
      `Animation:  ${animationLabel}`,
      `Notiz:      ${input.note ?? "(keine)"}`,
    ].join("\n");
    const escapedNote = input.note
      ? escapeHtml(input.note).replace(/\n/g, "<br>")
      : null;
    const noteBlock = escapedNote
      ? `<blockquote style="margin:0 0 32px 0; padding:18px 20px; background:#f5f5f7; border-left:3px solid #58BAB5; border-radius:0 8px 8px 0; color:#10101a; font-size:15px; line-height:1.55; letter-spacing:0.012em;">${escapedNote}</blockquote>`
      : `<p style="font-size:14px; line-height:1.55; color:#6a6a74; margin:0 0 32px 0; letter-spacing:0.012em;">Keine Notiz hinterlegt.</p>`;
    const html = renderEmailLayout({
      preheader: `${clinicLabel} möchte ${animationLabel} angepasst haben.`,
      heading: `Animations-Anfrage aus ${clinicLabel}`,
      introHtml: `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 28px 0; letter-spacing:0.012em;">Neue Anpassungs-Anfrage aus dem Portal.</p>`,
      customBlockHtml: noteBlock,
      auditRows: [
        { label: "Animation", value: animationLabel },
        { label: "Nutzer", value: session.email },
      ],
      footerLines: [
        "Interne Benachrichtigung · EINS Portal",
        "Diese E-Mail wurde automatisch versendet. Bitte antworten Sie nicht direkt.",
      ],
    });
    await getEmailSender().send({
      to: "team@eins.ag",
      subject,
      text,
      html,
    });
  } catch {
    // Swallow — the request is persisted.
  }

  revalidatePath("/medien");
  return { ok: true };
}
