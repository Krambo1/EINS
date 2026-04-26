import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withApi } from "@/server/api";
import { db, schema } from "@/db/client";

/**
 * GET /api/notifications
 *
 * Notifications feed for the current user. By default returns the 50 most
 * recent (read and unread). Pass `unreadOnly=1` for the bell badge count.
 */
const Query = z.object({
  unreadOnly: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withApi({}, async ({ session, request }) => {
  const url = new URL(request.url);
  const q = Query.parse(Object.fromEntries(url.searchParams));

  const predicates = [eq(schema.notifications.userId, session.userId)];
  if (q.unreadOnly === "1") predicates.push(isNull(schema.notifications.readAt));

  const [items, [{ unread }]] = await Promise.all([
    db
      .select()
      .from(schema.notifications)
      .where(and(...predicates))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(q.limit),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, session.userId),
          isNull(schema.notifications.readAt)
        )
      ),
  ]);

  return {
    items: items.map((n) => ({
      ...n,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unread: Number(unread ?? 0),
  };
});
