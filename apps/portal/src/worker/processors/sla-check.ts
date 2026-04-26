import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * SLA breach scan. Runs every 15 minutes via cron.
 *
 * For every clinic with requests where:
 *   - status in (neu, qualifiziert)
 *   - first_contacted_at IS NULL
 *   - sla_respond_by < now()
 *   - AND we haven't yet created a notification for this breach
 *
 * → insert a notification row for every Inhaber + Frontdesk user of that clinic,
 *   and write an audit entry.
 *
 * Idempotency: notification.kind='sla_breach' carries the requestId in `link`
 * as /anfragen/<id>. Before insert we check if such a row already exists.
 */

export interface SlaCheckJob {
  /** Optional: limit to one clinic. Omitted = scan all. */
  clinicId?: string;
}

export async function processSlaCheck(job: SlaCheckJob = {}): Promise<void> {
  const predicates = [
    inArray(schema.requests.status, ["neu", "qualifiziert"]),
    isNull(schema.requests.firstContactedAt),
    sql`${schema.requests.slaRespondBy} < now()`,
  ];
  if (job.clinicId) predicates.push(eq(schema.requests.clinicId, job.clinicId));

  const breached = await db
    .select({
      id: schema.requests.id,
      clinicId: schema.requests.clinicId,
      contactName: schema.requests.contactName,
      slaRespondBy: schema.requests.slaRespondBy,
    })
    .from(schema.requests)
    .where(and(...predicates));

  if (breached.length === 0) return;

  // Pre-load notified requestIds to stay idempotent.
  const existing = await db
    .select({ link: schema.notifications.link })
    .from(schema.notifications)
    .where(eq(schema.notifications.kind, "sla_breach"));
  const notifiedIds = new Set(
    existing
      .map((e) => e.link?.split("/").pop())
      .filter((v): v is string => Boolean(v))
  );

  for (const r of breached) {
    if (notifiedIds.has(r.id)) continue;

    // Fan out: all inhaber + frontdesk of this clinic (they own response).
    const users = await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, r.clinicId),
          isNull(schema.clinicUsers.archivedAt),
          inArray(schema.clinicUsers.role, ["inhaber", "frontdesk"])
        )
      );
    if (users.length === 0) continue;

    const title = "Reaktionszeit überschritten";
    const body = r.contactName
      ? `Anfrage von ${r.contactName} wartet noch auf Antwort.`
      : "Eine Anfrage wartet noch auf Antwort.";
    const link = `/anfragen/${r.id}`;

    await db.insert(schema.notifications).values(
      users.map((u) => ({
        userId: u.id,
        clinicId: r.clinicId,
        kind: "sla_breach",
        title,
        body,
        link,
      }))
    );
  }
}
