import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withApi } from "@/server/api";
import { db, schema } from "@/db/client";

/**
 * POST /api/notifications/read
 *
 * Mark notifications as read. Body is either:
 *   { ids: [uuid, ...] }   → mark specific rows
 *   { all: true }          → mark every unread row for the user
 *
 * Cross-user rows are silently ignored (eq userId predicate in WHERE).
 */
const Body = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

export const POST = withApi(
  { audit: { action: "update", entityKind: "notification" } },
  async ({ session, request }) => {
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

    const result = await db
      .update(schema.notifications)
      .set({ readAt: now })
      .where(and(...predicates))
      .returning({ id: schema.notifications.id });

    return { ok: true, updated: result.length };
  }
);
