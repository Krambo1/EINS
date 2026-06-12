import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withApiTx } from "@/server/api";
import { schema } from "@/db/client";

/**
 * POST /api/notifications/read
 *
 * Mark notifications as read. Body is either:
 *   { ids: [uuid, ...] }   → mark specific rows
 *   { all: true }          → mark every unread row for the user
 *
 * Cross-user rows are silently ignored (eq userId predicate in WHERE).
 *
 * Runs through `withApiTx` so the UPDATE executes on the RLS-scoped `dbApp`
 * connection (clinic context set) rather than the BYPASSRLS superuser pool
 * (pentest I4). The `userId` predicate already scopes to the caller; the RLS
 * `clinic_id = app_current_clinic()` WITH CHECK is the defense-in-depth layer
 * so a future predicate bug can never touch another tenant's rows.
 */
const Body = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

export const POST = withApiTx(
  { audit: { action: "update", entityKind: "notification" } },
  async ({ session, request, tx }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = Body.parse(body);
    const now = new Date();

    const predicates = [
      eq(schema.notifications.userId, session.userId),
      isNull(schema.notifications.readAt),
    ];
    if ("ids" in parsed) {
      predicates.push(inArray(schema.notifications.id, parsed.ids));
    }

    const result = await tx
      .update(schema.notifications)
      .set({ readAt: now })
      .where(and(...predicates))
      .returning({ id: schema.notifications.id });

    return { ok: true, updated: result.length };
  }
);
