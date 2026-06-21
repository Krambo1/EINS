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
  isAnswered,
  type DiscoveryAnswers,
} from "./content";

const AnswerValue = z.union([
  z.string().max(4000),
  z.array(z.string().max(400)).max(10),
]);

const Input = z.object({
  answers: z.record(z.string(), AnswerValue),
  submit: z.boolean(),
});

export type SaveDiscoveryState =
  | { kind: "idle" }
  | { kind: "error"; message: string; missingIds?: string[] }
  | { kind: "saved" }
  | { kind: "submitted" };

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
  const { submit } = parsed.data;

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
        message: `Es fehlen noch ${missing.length} Pflichtfragen. Die offenen Fragen sind unten markiert.`,
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
  }

  let wasResubmit = false;
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [existing] = await tx
      .select({
        id: schema.discoveryFragebogen.id,
        submittedAt: schema.discoveryFragebogen.submittedAt,
        submittedBy: schema.discoveryFragebogen.submittedBy,
        resubmittedAt: schema.discoveryFragebogen.resubmittedAt,
      })
      .from(schema.discoveryFragebogen)
      .where(eq(schema.discoveryFragebogen.clinicId, session.clinicId))
      .limit(1);

    const now = new Date();
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
      await tx
        .insert(schema.discoveryFragebogen)
        .values({ clinicId: session.clinicId, ...values });
    }
  });

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
  return submit ? { kind: "submitted" } : { kind: "saved" };
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
