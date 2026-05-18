import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { CURRENT_QUESTIONS_VERSION } from "@/app/(portal)/leitfaden/pruefung/questions";

/**
 * Returns true iff the given user has at least one passed quiz attempt
 * recorded at or above the current questions version. Used by the layout
 * to drive the sidebar "Schulung ausstehend" badge.
 */
export async function hasUserPassedLeitfadenQuiz(
  clinicId: string,
  userId: string
): Promise<boolean> {
  const rows = await withClinicContext(
    clinicId,
    userId,
    (tx) =>
      tx
        .select({ id: schema.leitfadenQuizAttempts.id })
        .from(schema.leitfadenQuizAttempts)
        .where(
          and(
            eq(schema.leitfadenQuizAttempts.userId, userId),
            eq(schema.leitfadenQuizAttempts.passed, true),
            gte(
              schema.leitfadenQuizAttempts.questionsVersion,
              CURRENT_QUESTIONS_VERSION
            )
          )
        )
        .limit(1),
    "leitfaden:pass-check"
  );
  return rows.length > 0;
}
