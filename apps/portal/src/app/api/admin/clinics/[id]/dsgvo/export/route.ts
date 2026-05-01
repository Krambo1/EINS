import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { exportClinicData } from "@/server/dsgvo";
import { writeAudit } from "@/server/audit";

/**
 * Art. 15 DSGVO — Auskunft.
 *
 * Admin-only. Returns one JSON document containing every clinic-scoped
 * row (secrets redacted). We write an audit entry before streaming the
 * body so the export is visible in the audit log even if the download is
 * aborted midway.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse(params.id);

  await writeAudit({
    clinicId: id,
    actorEmail: admin.email,
    action: "export",
    entityKind: "dsgvo_export",
    entityId: id,
  });

  const payload = await exportClinicData(id);
  const body = JSON.stringify(payload, null, 2);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dsgvo-export-${payload.exportedAt}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
