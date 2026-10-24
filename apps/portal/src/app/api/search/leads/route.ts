import { z } from "zod";
import { withApi } from "@/server/api";
import { searchRequestsLite } from "@/server/queries/requests";
import type { LeadSearchResult } from "@/lib/search/types";

/**
 * POST /api/search/leads  body: { "q": "…" }
 *
 * L-5: the term (patient name, phone, e-mail) travels in the body, never in
 * the URL, so it stays out of platform access logs and browser history.
 *
 * Lightweight typeahead source for the global command palette. Uses
 * `searchRequestsLite` (RLS-enforced via `withClinicContext`): same search
 * predicate as the inbox, no count, no joins, capped at 6 hits (D-20).
 *
 * Returns 200 [] for queries < 2 chars so the client can call freely while
 * the user is still typing without piling up 422s in the network panel.
 *
 * POST responses are not cached (the old GET had `private, max-age=10`).
 */
const Body = z.object({
  q: z.string().max(200).optional(),
});

export const POST = withApi(
  { permission: "requests.view" },
  async ({ session, request }): Promise<LeadSearchResult[]> => {
    const { q } = Body.parse(await request.json().catch(() => ({})));
    const term = q?.trim() ?? "";
    if (term.length < 2) return [];

    const items = await searchRequestsLite(session.clinicId, session.userId, term, 6);

    return items.map((r): LeadSearchResult => {
      const title = r.contactName?.trim() || r.contactEmail || r.contactPhone || "(Ohne Namen)";
      const subtitleParts: string[] = [];
      if (r.treatmentWish) subtitleParts.push(r.treatmentWish);
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
