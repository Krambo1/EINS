import { z } from "zod";
import { eq } from "drizzle-orm";
import { withApi } from "@/server/api";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";

const Body = z.object({ mode: z.enum(["einfach", "detail"]) });

export const PATCH = withApi({}, async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = Body.parse(body);
  const previous = session.uiMode;
  await db
    .update(schema.clinicUsers)
    .set({ uiMode: parsed.mode })
    .where(eq(schema.clinicUsers.id, session.userId));
  // Specific audit row so Karam can see who flips Detail vs Einfach.
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "ui_mode_change",
    entityKind: "settings",
    entityId: session.userId,
    diff: { from: previous, to: parsed.mode },
  });
  return { ok: true, mode: parsed.mode };
});
