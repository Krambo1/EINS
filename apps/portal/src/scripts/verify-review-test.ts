import "../worker/shim-server-only";
import "../lib/load-env";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

async function main() {
  const rows = await db
    .select({
      id: schema.requestRecalls.id,
      kind: schema.requestRecalls.kind,
      status: schema.requestRecalls.status,
      scheduledFor: schema.requestRecalls.scheduledFor,
      reviewEmail: schema.requestRecalls.reviewEmail,
      reviewPatientName: schema.requestRecalls.reviewPatientName,
      sentAt: schema.requestRecalls.sentAt,
      note: schema.requestRecalls.note,
      createdAt: schema.requestRecalls.createdAt,
    })
    .from(schema.requestRecalls)
    .where(eq(schema.requestRecalls.kind, "review_request"))
    .orderBy(desc(schema.requestRecalls.createdAt))
    .limit(10);
  console.log("=== last 10 review_request recalls ===");
  for (const r of rows) console.log(r);
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
