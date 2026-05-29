import "../worker/shim-server-only";
import "../lib/load-env";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

async function main() {
  const rows = await db
    .select({
      id: schema.reviewEmailSchedule.id,
      kind: schema.reviewEmailSchedule.kind,
      status: schema.reviewEmailSchedule.status,
      scheduledFor: schema.reviewEmailSchedule.scheduledFor,
      reviewEmail: schema.reviewEmailSchedule.reviewEmail,
      reviewPatientName: schema.reviewEmailSchedule.reviewPatientName,
      sentAt: schema.reviewEmailSchedule.sentAt,
      note: schema.reviewEmailSchedule.note,
      createdAt: schema.reviewEmailSchedule.createdAt,
    })
    .from(schema.reviewEmailSchedule)
    .where(eq(schema.reviewEmailSchedule.kind, "review_request"))
    .orderBy(desc(schema.reviewEmailSchedule.createdAt))
    .limit(10);
  console.log("=== last 10 review-request rows ===");
  for (const r of rows) console.log(r);
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
