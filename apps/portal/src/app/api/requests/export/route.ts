import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/auth/session";
import { can } from "@/lib/roles";
import { writeAudit } from "@/server/audit";
import { exportRequests } from "@/server/queries/requests";
import {
  AI_CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  type AiCategory,
  type RequestSource,
  type RequestStatus,
} from "@/lib/constants";
import { berlinDateString, formatDateTime } from "@/lib/formatting";
import { parseAnfragenParams } from "@/app/(portal)/anfragen/_lib/list-params";
import { buildCsv } from "./csv";

/**
 * GET /api/requests/export?<same params as /anfragen>
 *
 * CSV of every Anfrage matching the current list filters and sort (H-09),
 * built server-side for German Excel. Only for roles that see patient
 * contact data in the list (`requests.view`); RLS via withClinicContext.
 * Every export is written to the audit log with the filters used (no
 * patient data in the log).
 */
export const dynamic = "force-dynamic";
// Bounded on Vercel (A-22): the query is capped by the 15 s statement timeout.
export const maxDuration = 30;

const HEADER = [
  "Eingegangen am",
  "Name",
  "E-Mail",
  "Telefon",
  "Behandlung",
  "Quelle",
  "Kampagne",
  "Beitrag",
  "Status",
  "KI-Bewertung",
  "Erstkontakt",
  "Nachricht",
  "Anfrage-ID",
] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Nicht angemeldet." } },
      { status: 401 }
    );
  }
  if (!can(session.role, "requests.view")) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Zugriff verweigert." } },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const params = parseAnfragenParams(Object.fromEntries(url.searchParams));
  const filters = {
    status: params.status,
    source: params.source,
    aiCategory: params.aiCategory,
    treatmentId: params.treatmentId,
    search: params.search,
    slaBreachedOnly: params.slaBreachedOnly,
    staleOnly: params.staleOnly,
  };

  const { rows, truncated } = await exportRequests(
    session.clinicId,
    session.userId,
    filters,
    params.sort
  );

  const csv = buildCsv(
    HEADER,
    rows.map((r) => [
      formatDateTime(r.createdAt),
      r.contactName,
      r.contactEmail,
      r.contactPhone,
      r.treatmentName ?? r.treatmentWish,
      SOURCE_LABELS[r.source as RequestSource] ?? r.source,
      r.utmCampaign,
      r.utmContent,
      REQUEST_STATUS_LABELS[r.status as RequestStatus] ?? r.status,
      r.aiCategory ? AI_CATEGORY_LABELS[r.aiCategory as AiCategory] ?? r.aiCategory : null,
      r.firstContactedAt ? formatDateTime(r.firstContactedAt) : null,
      r.message,
      r.id,
    ])
  );

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "export",
    entityKind: "request",
    diff: {
      format: "csv",
      rows: rows.length,
      truncated,
      // Filter keys and enum values only; the free-text search can be a
      // patient name, so only whether one was used is logged.
      filters: {
        status: filters.status ?? null,
        source: filters.source ?? null,
        aiCategory: filters.aiCategory ?? null,
        treatmentCount: filters.treatmentId?.length ?? 0,
        search: Boolean(filters.search),
        slaBreachedOnly: filters.slaBreachedOnly,
        staleOnly: filters.staleOnly,
        sort: params.sort,
      },
      ...(session.impersonatedByAdminId
        ? { impersonatedByAdminId: session.impersonatedByAdminId }
        : {}),
    },
  });

  const filename = `anfragen-${berlinDateString()}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      ...(truncated ? { "X-Export-Truncated": "1" } : {}),
    },
  });
}
