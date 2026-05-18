import { z } from "zod";
import { withApi } from "@/server/api";
import { listRequests } from "@/server/queries/requests";
import type { LeadSearchResult } from "@/lib/search/types";

/**
 * GET /api/search/leads?q=…
 *
 * Lightweight typeahead source for the global command palette. Reuses
 * `listRequests` (RLS-enforced via `withClinicContext`), capped at 6 hits.
 *
 * Returns 200 [] for queries < 2 chars so the client can call freely while
 * the user is still typing without piling up 422s in the network panel.
 *
 * Cache: `private, max-age=10` — per-user, short lifetime. The clinic
 * inbox doesn't change second-to-second; 10 s smooths out the rapid
 * back-and-forth that happens when a user opens / closes the palette.
 */
const Query = z.object({
  q: z.string().max(200).optional(),
});

export const GET = withApi(
  { permission: "requests.view", cacheControl: "max-age=10" },
  async ({ session, request }): Promise<LeadSearchResult[]> => {
    const url = new URL(request.url);
    const { q } = Query.parse(Object.fromEntries(url.searchParams));
    const term = q?.trim() ?? "";
    if (term.length < 2) return [];

    const { items } = await listRequests(
      session.clinicId,
      session.userId,
      { search: term },
      { limit: 6 }
    );

    return items.map((r): LeadSearchResult => {
      const title = r.contactName?.trim() || r.contactEmail || r.contactPhone || "(Ohne Namen)";
      const subtitleParts: string[] = [];
      if (r.treatmentName) subtitleParts.push(r.treatmentName);
      else if (r.treatmentWish) subtitleParts.push(r.treatmentWish);
      if (r.contactEmail && r.contactEmail !== title) subtitleParts.push(r.contactEmail);
      return {
        id: r.id,
        title,
        subtitle: subtitleParts.join(" · ") || "Anfrage",
        href: `/anfragen/${r.id}`,
      };
    });
  }
);
