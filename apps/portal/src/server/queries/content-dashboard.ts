import "server-only";
import { and, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { summarizePublications } from "@/lib/content-items";
import { isContentStatus, type ContentStatus } from "@/lib/content-status";
import { cacheClinicQuery, SHORT_REVALIDATE_S } from "./_cache";

/** Posts the Inhalte card on the Übersicht shows at most (four tiles from xl). */
export const DASHBOARD_POST_SLOTS = 4;

export interface DashboardPost {
  id: string;
  title: string;
  format: string;
  status: ContentStatus;
  /** ISO time of the first publication; null while never online. */
  liveSince: string | null;
  /** ISO time it went offline; null while still online. */
  stoppedAt: string | null;
  /** Anfragen that came through the post's links in the window, spam excluded. */
  leads: number;
  /** Of those, the gewonnenen. */
  won: number;
  /** The post's file, for the preview. */
  asset: { storageKey: string; muxPlaybackId: string | null; kind: string; mimeType: string | null } | null;
}

export interface DashboardPosts {
  /** Online in the window or with an Anfrage in it; most Anfragen first, then newest. */
  posts: DashboardPost[];
  /**
   * Posts waiting for the Praxis' Freigabe that are not in `posts`, newest
   * first, for the slots the online posts leave free (at most that many).
   */
  waitingPosts: DashboardPost[];
  /** Posts waiting for the Praxis' Freigabe, whatever the period. */
  waiting: number;
  /** Whether a post was ever online. */
  anyOnline: boolean;
}

/**
 * The posts of the Übersicht's Inhalte card for one period: which posts were
 * online and how many Anfragen each brought in it. An Anfrage belongs to a
 * post through the post code in its links (requests.content_item_id). Dates
 * come back as ISO strings, so the cached value survives serialisation.
 */
async function dashboardPostsUncached(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<DashboardPosts> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [items, pubs, counts] = await Promise.all([
        tx
          .select({
            id: schema.contentItems.id,
            title: schema.contentItems.title,
            format: schema.contentItems.format,
            status: schema.contentItems.status,
            updatedAt: schema.contentItems.updatedAt,
            storageKey: schema.assets.storageKey,
            muxPlaybackId: schema.assets.muxPlaybackId,
            kind: schema.assets.kind,
            mimeType: schema.assets.mimeType,
          })
          .from(schema.contentItems)
          .leftJoin(schema.assets, eq(schema.contentItems.assetId, schema.assets.id))
          .where(
            and(
              eq(schema.contentItems.clinicId, clinicId),
              ne(schema.contentItems.status, "entwurf")
            )
          ),
        tx
          .select({
            contentItemId: schema.contentPublications.contentItemId,
            publishedAt: schema.contentPublications.publishedAt,
            stoppedAt: schema.contentPublications.stoppedAt,
          })
          .from(schema.contentPublications)
          .where(eq(schema.contentPublications.clinicId, clinicId)),
        tx
          .select({
            id: sql<string>`${schema.requests.contentItemId}`,
            leads: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} <> 'spam')::int`,
            won: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
          })
          .from(schema.requests)
          .where(
            and(
              eq(schema.requests.clinicId, clinicId),
              isNotNull(schema.requests.contentItemId),
              gte(schema.requests.createdAt, from),
              lte(schema.requests.createdAt, to)
            )
          )
          .groupBy(schema.requests.contentItemId),
      ]);

      const byItem = new Map(counts.map((c) => [c.id, c]));
      let anyOnline = false;
      const shown: DashboardPost[] = [];
      const waiting: Array<{ post: DashboardPost; updatedAt: Date }> = [];
      for (const it of items) {
        const status = isContentStatus(it.status) ? it.status : "entwurf";
        const { liveSince, stoppedAt } = summarizePublications(
          status,
          it.updatedAt,
          pubs.filter((p) => p.contentItemId === it.id)
        );
        if (liveSince) anyOnline = true;
        const c = byItem.get(it.id);
        const leads = Number(c?.leads ?? 0);
        const post: DashboardPost = {
          id: it.id,
          title: it.title,
          format: it.format,
          status,
          liveSince: liveSince ? liveSince.toISOString() : null,
          stoppedAt: stoppedAt ? stoppedAt.toISOString() : null,
          leads,
          won: Number(c?.won ?? 0),
          asset: it.storageKey
            ? {
                storageKey: it.storageKey,
                muxPlaybackId: it.muxPlaybackId ?? null,
                kind: it.kind ?? "",
                mimeType: it.mimeType ?? null,
              }
            : null,
        };
        const onlineInWindow =
          !!liveSince && liveSince <= to && (!stoppedAt || stoppedAt >= from);
        if (onlineInWindow || leads > 0) shown.push(post);
        else if (status === "zur_freigabe") waiting.push({ post, updatedAt: it.updatedAt });
      }
      shown.sort(
        (a, b) => b.leads - a.leads || (b.liveSince ?? "").localeCompare(a.liveSince ?? "")
      );
      const posts = shown.slice(0, DASHBOARD_POST_SLOTS);
      waiting.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      return {
        posts,
        waitingPosts: waiting.slice(0, DASHBOARD_POST_SLOTS - posts.length).map((w) => w.post),
        waiting: items.filter((i) => i.status === "zur_freigabe").length,
        anyOnline,
      };
    },
    "dashboard:posts"
  );
}

/** Cached for SHORT_REVALIDATE_S like the other Übersicht cards. */
export const dashboardPosts = cacheClinicQuery("dashboardPosts", dashboardPostsUncached, {
  dateArgs: [0, 1],
  revalidate: SHORT_REVALIDATE_S,
});
