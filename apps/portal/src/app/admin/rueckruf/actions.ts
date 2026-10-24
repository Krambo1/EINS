"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { getRueckrufLage } from "@/server/response-enforcement";
import { ENFORCEMENT_THRESHOLD, warningEmailText, type EnforcementKind } from "@/lib/response-time";
import { endOfNextWerktag } from "@/lib/werkstunden";
import { sendClinicNotice } from "@/server/clinic-notices";
import { eq, sql } from "drizzle-orm";

/**
 * Admin actions for the Rückruf-Lage (Folge 3, migration 0076). The warning
 * can be sent from here (sendWarningAction, stored in clinic_notices, H-03)
 * or, when Karam mailed it himself, only recorded. The pause happens in the
 * ad account; here it is recorded.
 *
 * Audit rows go WITHOUT clinicId, like the Garantie-Uhr: the Praxis sees its
 * own audit rows under Einstellungen, and this page is admin only. The clinic
 * id goes into entityId.
 */

const PATH = "/admin/rueckruf";
const Uuid = z.string().uuid();

function fail(message: string): never {
  redirect(`${PATH}?fehler=${encodeURIComponent(message)}`);
}

const Input = z.object({
  clinicId: Uuid,
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/** What the action does besides recording the event. */
type Mode = "record_only" | "send_warning";

/** K-14: rolls the event back when the warning reached nobody. */
class NoticeUndelivered extends Error {}

async function record(kind: EnforcementKind, formData: FormData, mode: Mode = "record_only") {
  const admin = await requireAdmin();
  const parsed = Input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Eingabe ungültig");
  const { clinicId, note } = parsed.data;

  // K-14: Folge 3 applies only while paid ads run (Garantie-Anhang § 6
  // Abs. (5) lit. c). The portal does not know the ad account, so Karam
  // confirms it with each pause.
  if (kind === "pause" && formData.get("adsRunning") !== "1") {
    fail("Eine Anzeigen-Pause gibt es nur, wenn bezahlte Anzeigen laufen. Bitte bestätigen, dass sie laufen.");
  }

  // G-08: the warning mail text shown on the page carries a cure deadline
  // computed at render time. If the page is stale, the deadline Karam copied
  // differs from the one recorded now; refuse instead of recording a
  // different Frist than the one the Praxis received.
  const expected = formData.get("expectedCureDeadline");
  if (kind === "warnung" && mode === "record_only" && typeof expected === "string" && expected) {
    if (endOfNextWerktag(new Date()).toISOString() !== expected) {
      fail("Die Seite ist veraltet, die Frist im Mail-Text stimmt nicht mehr. Seite neu laden und den Text neu kopieren.");
    }
  }

  // Serialise per clinic (double click, two tabs): the second call waits for
  // the first to commit, then re-reads the state and fails canWarn/canPause.
  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('eins:rueckruf:' || ${clinicId}))`);

      const now = new Date();
      const lage = await getRueckrufLage(clinicId, now);
      if (!lage) return { error: "Praxis nicht gefunden." } as const;
      const s = lage.state;

      let requestIds: string[] = [];
      if (kind === "warnung") {
        if (s.paused) return { error: "Die Anzeigen sind bereits pausiert." } as const;
        if (s.overdueOpen.length < ENFORCEMENT_THRESHOLD) {
          return { error: "Eine Warnung ist erst ab drei offenen Anfragen ohne Kontaktversuch möglich." } as const;
        }
        // A second warning would silently move the cure deadline.
        if (!s.canWarn) return { error: "Es läuft bereits eine Warnung." } as const;
        requestIds = s.overdueOpen.map((r) => r.id);
      } else if (kind === "pause") {
        if (!s.canPause) return { error: s.pauseBlockedReason ?? "Pause zurzeit nicht möglich." } as const;
        // The resume condition: exactly these inquiries need an attempt.
        requestIds = s.overdueOpen.map((r) => r.id);
      } else if (!s.paused) {
        return { error: "Die Anzeigen sind nicht pausiert." } as const;
      }

      // K-14: write the event first. If the insert fails, no mail has gone
      // out. Then send (H-03, the exact text is stored) and complete the note;
      // a warning that reached nobody rolls the event back.
      const [row] = await tx
        .insert(schema.responseEnforcementEvents)
        .values({
          clinicId,
          kind,
          occurredAt: now,
          requestIds,
          note,
          createdBy: admin.email,
        })
        .returning({ id: schema.responseEnforcementEvents.id });

      let noticeId: string | null = null;
      if (mode === "send_warning" && row) {
        const email = warningEmailText({ count: s.overdueOpen.length, cureDeadline: endOfNextWerktag(now) });
        const notice = await sendClinicNotice({
          clinicId,
          kind: "warnung_rueckruf",
          subject: email.subject,
          body: email.body,
          createdBy: admin.email,
        });
        if (!notice.sentAt) throw new NoticeUndelivered();
        noticeId = notice.id;
        const noticeNote = `per E-Mail an ${notice.recipients.join(", ")}`;
        await tx
          .update(schema.responseEnforcementEvents)
          .set({ note: [note, noticeNote].filter(Boolean).join(" · ") })
          .where(eq(schema.responseEnforcementEvents.id, row.id));
      }

      return { eventId: row?.id ?? null, overdue: s.overdueOpen.length, requestIds, noticeId } as const;
    });
  } catch (err) {
    if (err instanceof NoticeUndelivered) {
      fail("Die Warnung konnte an niemanden zugestellt werden. Nichts vermerkt. Empfänger im Team-Tab prüfen.");
    }
    throw err;
  }

  if ("error" in outcome) fail(outcome.error ?? "Aktion nicht möglich.");

  await writeAudit({
    actorEmail: admin.email,
    action: kind === "fortgesetzt" ? "update" : "create",
    entityKind: "response_enforcement",
    entityId: clinicId,
    diff: {
      eventId: outcome.eventId,
      kind,
      overdueCount: outcome.overdue,
      requestCount: outcome.requestIds.length,
      ...(outcome.noticeId ? { noticeId: outcome.noticeId } : {}),
    },
  });

  revalidatePath(PATH);
}

export async function recordWarningAction(formData: FormData) {
  await record("warnung", formData);
}

export async function sendWarningAction(formData: FormData) {
  await record("warnung", formData, "send_warning");
}

export async function recordPauseAction(formData: FormData) {
  await record("pause", formData);
}

export async function recordResumeAction(formData: FormData) {
  await record("fortgesetzt", formData);
}
