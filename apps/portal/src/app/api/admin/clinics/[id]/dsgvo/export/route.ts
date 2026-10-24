import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminForApi } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { exportClinicDataChunks } from "@/server/dsgvo";
import { writeAudit } from "@/server/audit";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { describeErrorForLog } from "@/lib/error-log";

/**
 * Art. 15 DSGVO — Auskunft.
 *
 * Admin-only. Streams one JSON document `{ exportedAt, clinicId, tables:
 * { <table>: [rows…] } }` with every clinic-scoped table (list derived from
 * the catalog, secrets redacted), chunk by chunk so a large event log never
 * sits in memory at once (G-15). The audit row "complete" is written only
 * when the client has read the whole document (pull stream, end of stream);
 * "failed" on a query error, "aborted" when the download is cancelled.
 */
export const maxDuration = 300;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminForApi();
  if (!gate.ok) return gate.response;
  const admin = gate.admin;

  const { id: rawId } = await params;
  const parsed = z.string().uuid().safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const id = parsed.data;

  const [clinic] = await db
    .select({ slug: schema.clinics.slug })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, id))
    .limit(1);
  if (!clinic) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const exportedAt = new Date().toISOString();
  const encoder = new TextEncoder();
  // Captured before streaming: headers() is not available once the response
  // body is being produced.
  const auditMeta = {
    ip: trustedIpFromHeaders(
      _request.headers.get("x-forwarded-for"),
      _request.headers.get("x-real-ip")
    ),
    ua: _request.headers.get("user-agent"),
  };

  let rows = 0;
  const audit = (status: "complete" | "failed" | "aborted") =>
    writeAudit({
      clinicId: id,
      actorEmail: admin.email,
      action: "export",
      entityKind: "dsgvo_export",
      entityId: id,
      diff: { status, rows },
      requestMeta: auditMeta,
    });

  /** The JSON document, one piece per DB chunk. */
  async function* produce(): AsyncGenerator<string> {
    yield `{"exportedAt":${JSON.stringify(exportedAt)},"clinicId":${JSON.stringify(id)},"tables":{`;
    let current: string | null = null;
    let firstTable = true;
    let firstRow = true;
    for await (const chunk of exportClinicDataChunks(id)) {
      let out = "";
      if (chunk.table !== current) {
        if (current !== null) out += "]";
        out += `${firstTable ? "" : ","}${JSON.stringify(chunk.table)}:[`;
        firstTable = false;
        firstRow = true;
        current = chunk.table;
      }
      for (const row of chunk.rows) {
        out += `${firstRow ? "" : ","}${JSON.stringify(row)}`;
        firstRow = false;
        rows++;
      }
      yield out;
    }
    yield `${current !== null ? "]" : ""}}}`;
  }

  // V1 Neben: pull-based with highWaterMark 0, so a piece is produced only
  // when the download asks for it. "complete" is audited only after the
  // client has read every piece and asked for more (end of stream); a failed
  // query audits "failed", an aborted download "aborted". Retention rule 3
  // erases an archived Praxis only after a "complete" export.
  const pieces = produce();
  let settled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await pieces.next();
          if (next.done) {
            settled = true;
            await audit("complete");
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(next.value));
        } catch (err) {
          settled = true;
          console.error("[dsgvo] export failed:", JSON.stringify(describeErrorForLog(err)));
          await audit("failed");
          controller.error(err);
        }
      },
      async cancel() {
        if (settled) return;
        settled = true;
        await pieces.return(undefined).catch(() => undefined);
        await audit("aborted");
      },
    },
    { highWaterMark: 0 }
  );

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dsgvo-export-${clinic.slug}-${exportedAt.slice(0, 10)}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
