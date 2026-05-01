import { z } from "zod";
import { withApi, ApiError } from "@/server/api";
import { listRequests } from "@/server/queries/requests";
import {
  REQUEST_STATUSES,
  REQUEST_SOURCES,
  AI_CATEGORIES,
  type RequestStatus,
} from "@/lib/constants";

/**
 * GET /api/requests
 *
 * Read-only paginated list of requests for the current user's clinic.
 * Mirrors `listRequests` and respects RLS.
 *
 * Query params (all optional):
 *   status=neu,qualifiziert
 *   source=meta,google
 *   aiCategory=hot,warm
 *   search=jens
 *   assignedTo=<userId>|unassigned
 *   slaBreachedOnly=1
 *   limit=50 (max 200)
 *   offset=0
 */
const Query = z.object({
  status: z.string().optional(),
  source: z.string().optional(),
  aiCategory: z.string().optional(),
  search: z.string().max(200).optional(),
  assignedTo: z.string().optional(),
  slaBreachedOnly: z.enum(["0", "1"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function splitCsv<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  return items.length > 0 ? items : undefined;
}

export const GET = withApi({ permission: "requests.view" }, async ({ session, request }) => {
  const url = new URL(request.url);
  const q = Query.parse(Object.fromEntries(url.searchParams));

  const status = splitCsv(q.status, REQUEST_STATUSES);
  const source = splitCsv(q.source, REQUEST_SOURCES);
  const aiCategory = splitCsv(q.aiCategory, AI_CATEGORIES);

  if (q.status && !status) {
    throw new ApiError(422, "validation", "Ungültiger Status.");
  }

  const assignedTo =
    q.assignedTo === "unassigned"
      ? "unassigned"
      : q.assignedTo && /^[0-9a-f-]{36}$/i.test(q.assignedTo)
      ? q.assignedTo
      : undefined;

  const { items, total } = await listRequests(
    session.clinicId,
    session.userId,
    {
      status: status as RequestStatus[] | undefined,
      source,
      aiCategory,
      search: q.search,
      assignedTo,
      slaBreachedOnly: q.slaBreachedOnly === "1",
    },
    { limit: q.limit, offset: q.offset }
  );

  return {
    items: items.map((i) => ({
      ...i,
      slaRespondBy: i.slaRespondBy?.toISOString() ?? null,
      firstContactedAt: i.firstContactedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
    total,
    limit: q.limit,
    offset: q.offset,
  };
});
