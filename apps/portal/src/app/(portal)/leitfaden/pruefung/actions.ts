"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import {
  CURRENT_QUESTIONS_VERSION,
  PASS_THRESHOLD,
  QUIZ_QUESTIONS,
  TOTAL_QUESTIONS,
} from "./questions";

const Input = z.object({
  answers: z.record(z.string(), z.string()),
});

export interface AnswerResult {
  questionId: string;
  chosenOptionId: string | null;
  correct: boolean;
}

export type SubmitQuizState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "submitted";
      score: number;
      total: number;
      passed: boolean;
      results: AnswerResult[];
    };

/**
 * Score the submitted answers server-side, persist the attempt, and return
 * a result snapshot the client can render. Unanswered questions count as
 * wrong. We never echo back the correct option — only whether each was
 * correct + a source hint — so retakes stay honest.
 */
export async function submitQuizAttemptAction(
  _prev: SubmitQuizState | undefined,
  formData: FormData
): Promise<SubmitQuizState> {
  const session = await requireSession();
  if (!can(session.role, "leitfaden.quiz")) {
    throw new ForbiddenError("leitfaden.quiz");
  }

  const answers: Record<string, string> = {};
  for (const q of QUIZ_QUESTIONS) {
    const raw = formData.get(`q:${q.id}`);
    if (typeof raw === "string" && raw.length > 0) {
      answers[q.id] = raw;
    }
  }

  const parsed = Input.safeParse({ answers });
  if (!parsed.success) {
    return {
      kind: "error",
      message:
        "Eingabe konnte nicht gelesen werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.",
    };
  }

  const results: AnswerResult[] = QUIZ_QUESTIONS.map((q) => {
    const chosenOptionId = parsed.data.answers[q.id] ?? null;
    const correctOptionId = q.options[q.correctIndex].id;
    return {
      questionId: q.id,
      chosenOptionId,
      correct: chosenOptionId === correctOptionId,
    };
  });

  const score = results.filter((r) => r.correct).length;
  const passed = score >= PASS_THRESHOLD;

  let attemptId: string | undefined;
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [row] = await tx
      .insert(schema.leitfadenQuizAttempts)
      .values({
        clinicId: session.clinicId,
        userId: session.userId,
        score,
        total: TOTAL_QUESTIONS,
        passed,
        questionsVersion: CURRENT_QUESTIONS_VERSION,
        answers: results,
      })
      .returning({ id: schema.leitfadenQuizAttempts.id });
    attemptId = row?.id;
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "submit_leitfaden_quiz",
    entityKind: "leitfaden_quiz_attempt",
    entityId: attemptId,
    diff: {
      score,
      total: TOTAL_QUESTIONS,
      passed,
      questionsVersion: CURRENT_QUESTIONS_VERSION,
    },
  });

  // Revalidate the layout (sidebar badge) + the leitfaden CTA + the pruefung
  // page itself so the next render reflects the new pass state.
  revalidatePath("/leitfaden", "layout");

  return {
    kind: "submitted",
    score,
    total: TOTAL_QUESTIONS,
    passed,
    results,
  };
}
