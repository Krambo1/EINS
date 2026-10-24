"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import {
  DISCOVERY_QUESTIONS_BY_ID,
  REQUIRED_DISCOVERY_IDS,
  customBudgetError,
  formatBudgetEur,
  isAnswered,
  parseEuroAmount,
  type DiscoveryAnswers,
} from "./content";

const CHANGED_ELSEWHERE =
  "Der Fragebogen wurde inzwischen an anderer Stelle geändert, zum Beispiel auf einem anderen Gerät. Ihre Eingaben hier sind auf diesem Gerät gesichert. Bitte laden Sie die Seite neu, danach können Sie sie übernehmen.";

const AnswerValue = z.union([
  z.string().max(4000),
  z.array(z.string().max(400)).max(10),
]);

const Input = z.object({
  answers: z.record(z.string(), AnswerValue),
  submit: z.boolean(),
  /**
   * `updatedAt` (ISO) of the row the client started from, null when there was
   * no row. A mismatch means another tab/device saved in between: reject
   * instead of silently overwriting (last writer must not win quietly).
   */
  baseUpdatedAt: z.string().max(40).nullable().optional(),
});

export type SaveDiscoveryState =
  | { kind: "idle" }
  | {
      kind: "error";
      message: string;
      missingIds?: string[];
      /** True when the row changed elsewhere since the client loaded it. */
      conflict?: boolean;
    }
  | { kind: "saved"; updatedAt: string }
  | { kind: "submitted"; updatedAt: string };

/**
 * Persist the Discovery-Fragebogen answers for the caller's clinic.
 *
 * `submit: false` saves a draft: anything goes, unknown ids and invalid
 * options are dropped silently (they can only come from stale clients).
 * `submit: true` additionally requires every Pflichtfrage to be answered and
 * freezes the row ('eingereicht'); after that the clinic can't edit anymore.
 */
export async function saveDiscoveryAction(
  input: z.infer<typeof Input>
): Promise<SaveDiscoveryState> {
  const session = await requireSession();
  if (!can(session.role, "onboarding.complete")) {
    throw new ForbiddenError("onboarding.complete");
  }

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "error",
      message: "Bitte prüfen Sie Ihre Eingaben und versuchen Sie es erneut.",
    };
  }
  const { submit, baseUpdatedAt } = parsed.data;

  // Keep only known question ids with type-correct, option-valid values.
  const answers: DiscoveryAnswers = {};
  for (const [id, raw] of Object.entries(parsed.data.answers)) {
    const q = DISCOVERY_QUESTIONS_BY_ID.get(id);
    if (!q) continue;
    if (q.type === "mehrfach") {
      if (!Array.isArray(raw)) continue;
      const valid = raw.filter((v) => q.options?.includes(v));
      const capped = q.maxSelect ? valid.slice(0, q.maxSelect) : valid;
      if (capped.length > 0) answers[id] = capped;
    } else if (q.type === "auswahl") {
      if (typeof raw !== "string") continue;
      const val = raw.trim();
      if (q.options?.includes(val)) {
        answers[id] = val;
      } else if (q.allowCustom && val.length > 0) {
        // Free-entry (e.g. budget); range-checked on submit via customBudgetError.
        answers[id] = val;
      }
      // else: unknown option from a stale client -> drop
    } else {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (trimmed.length > 0) answers[id] = trimmed;
    }
  }

  if (submit) {
    const missing = REQUIRED_DISCOVERY_IDS.filter(
      (id) => !isAnswered(answers[id])
    );
    if (missing.length > 0) {
      return {
        kind: "error",
        message:
          missing.length === 1
            ? "Es fehlt noch 1 Pflichtfrage. Die offene Frage ist unten markiert."
            : `Es fehlen noch ${missing.length} Pflichtfragen. Die offenen Fragen sind unten markiert.`,
        missingIds: missing,
      };
    }
    const budgetErr = customBudgetError(answers);
    if (budgetErr) {
      return {
        kind: "error",
        message: budgetErr.message,
        missingIds: [budgetErr.id],
      };
    }
    // Store free-entry amounts normalised ("2000" -> "2.000 €") so EINS and
    // the admin view read one unambiguous number.
    for (const [id, v] of Object.entries(answers)) {
      const q = DISCOVERY_QUESTIONS_BY_ID.get(id);
      if (!q?.allowCustom || typeof v !== "string" || q.options?.includes(v)) {
        continue;
      }
      const eur = parseEuroAmount(v);
      if (eur !== null) answers[id] = formatBudgetEur(eur);
    }
  }

  let wasResubmit = false;
  let rejected = null as SaveDiscoveryState | null;
  const now = new Date();
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [existing] = await tx
      .select({
        id: schema.discoveryFragebogen.id,
        status: schema.discoveryFragebogen.status,
        updatedAt: schema.discoveryFragebogen.updatedAt,
        submittedAt: schema.discoveryFragebogen.submittedAt,
        submittedBy: schema.discoveryFragebogen.submittedBy,
        resubmittedAt: schema.discoveryFragebogen.resubmittedAt,
      })
      .from(schema.discoveryFragebogen)
      .where(eq(schema.discoveryFragebogen.clinicId, session.clinicId))
      .limit(1)
      .for("update");

    // Stale tab/device: the row moved on since this form was loaded. Never
    // overwrite it silently; the client keeps the typed answers locally.
    if (baseUpdatedAt !== undefined) {
      const current = existing?.updatedAt?.toISOString() ?? null;
      if (current !== baseUpdatedAt) {
        rejected = {
          kind: "error",
          conflict: true,
          message: CHANGED_ELSEWHERE,
        };
        return;
      }
    }
    // A draft save never downgrades a submitted row; only "Antworten
    // anpassen" (reopenDiscoveryAction) reopens it.
    if (!submit && existing?.status === "eingereicht") {
      rejected = {
        kind: "error",
        conflict: true,
        message:
          "Der Fragebogen ist bereits eingereicht. Bitte laden Sie die Seite neu und klicken Sie auf \"Antworten anpassen\", wenn Sie etwas ändern möchten. Ihre Eingaben hier sind auf diesem Gerät gesichert.",
      };
      return;
    }

    // Owners can reopen + edit after the first submit (the page gates editing
    // via reopenDiscoveryAction). A submit on a row that was ever submitted
    // before is a *re-submit*: keep the original submittedAt and stamp
    // resubmittedAt so the admin side sees the baseline changed.
    const everSubmitted = Boolean(existing?.submittedAt);
    wasResubmit = submit && everSubmitted;

    const values = {
      answers,
      status: submit ? ("eingereicht" as const) : ("entwurf" as const),
      // First submit sets submittedAt; later edits keep the original.
      submittedAt: submit
        ? existing?.submittedAt ?? now
        : existing?.submittedAt ?? null,
      submittedBy: submit
        ? existing?.submittedBy ?? session.userId
        : existing?.submittedBy ?? null,
      resubmittedAt: wasResubmit ? now : existing?.resubmittedAt ?? null,
      updatedAt: now,
      updatedBy: session.userId,
    };

    if (existing) {
      await tx
        .update(schema.discoveryFragebogen)
        .set(values)
        .where(eq(schema.discoveryFragebogen.id, existing.id));
    } else {
      // V6 Neben: two tabs saving the first draft at once both see no row;
      // the unique key on clinic_id lets only one insert win. The other one
      // gets the same "changed elsewhere" answer as a stale tab instead of
      // a unique-key error.
      const inserted = await tx
        .insert(schema.discoveryFragebogen)
        .values({ clinicId: session.clinicId, ...values })
        .onConflictDoNothing({ target: schema.discoveryFragebogen.clinicId })
        .returning({ id: schema.discoveryFragebogen.id });
      if (inserted.length === 0) {
        rejected = { kind: "error", conflict: true, message: CHANGED_ELSEWHERE };
        return;
      }
    }
  });
  if (rejected) return rejected;

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: submit
      ? wasResubmit
        ? "resubmit_discovery_fragebogen"
        : "submit_discovery_fragebogen"
      : "save_discovery_fragebogen",
    entityKind: "discovery_fragebogen",
    diff: {
      answeredCount: Object.keys(answers).length,
      submit,
      resubmit: wasResubmit,
    },
  });

  revalidatePath("/onboarding/fragebogen");
  revalidatePath("/onboarding");
  const updatedAt = now.toISOString();
  return submit
    ? { kind: "submitted", updatedAt }
    : { kind: "saved", updatedAt };
}

/**
 * Reopen a submitted questionnaire for editing (owner clicked "Antworten
 * anpassen"). Flips 'eingereicht' -> 'entwurf' so the form renders again; the
 * original submittedAt is preserved, so the access gate stays open and the
 * eventual re-submit is recorded as a resubmit (admin-visible). No-op when the
 * row isn't currently submitted.
 */
export async function reopenDiscoveryAction(): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "onboarding.complete")) {
    throw new ForbiddenError("onboarding.complete");
  }

  let reopened = false;
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [existing] = await tx
      .select({
        id: schema.discoveryFragebogen.id,
        status: schema.discoveryFragebogen.status,
      })
      .from(schema.discoveryFragebogen)
      .where(eq(schema.discoveryFragebogen.clinicId, session.clinicId))
      .limit(1);
    if (!existing || existing.status !== "eingereicht") return;

    await tx
      .update(schema.discoveryFragebogen)
      .set({ status: "entwurf", updatedAt: new Date(), updatedBy: session.userId })
      .where(eq(schema.discoveryFragebogen.id, existing.id));
    reopened = true;
  });

  if (reopened) {
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "reopen_discovery_fragebogen",
      entityKind: "discovery_fragebogen",
    });
  }

  revalidatePath("/onboarding/fragebogen");
  revalidatePath("/onboarding");
}
