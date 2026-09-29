import "server-only";
import { randomUUID } from "node:crypto";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { sqlClient } from "@/db/client";
import { env, hasR2 } from "@/lib/env";
import { constantTimeEqual, deriveSigningKey } from "@/lib/crypto";
import {
  MAX_POSTER_BYTES,
  MAX_VIDEO_BYTES,
  SLUG_ALPHABET,
  SLUG_LENGTH,
  SLUG_PATTERN,
  VIDEO_KEY_PREFIX,
  deviceFromUserAgent,
  extensionOf,
  isVideoExtension,
  normalizeNotionId,
  publicVideoUrl,
  type VideoEventInput,
} from "@/lib/outreach-video";
import { viewerHash } from "@/lib/outreach-video-hash";
import { getStorage } from "@/server/storage";
import { normalizeContentType } from "@/server/uploads";

/**
 * Outreach videos on eins.ag/v/<slug> (migration 0073).
 *
 * Three callers share this module: the admin page (upload + stats), the
 * public routes the website's watch page talks to, and the token API the
 * outreach tooling uses. Bytes never pass through here: uploads go straight
 * to R2 with a presigned PUT (see server/uploads.ts for why), and this module
 * only mints the target and later verifies the object landed.
 *
 * All queries run on the superuser handle; these tables have no RLS and no
 * app-role grant (see the migration header).
 */

const newSlug = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signed playback URLs outlive a long viewing session by a wide margin. */
const PLAYBACK_URL_TTL_SECONDS = 6 * 60 * 60;

export type VideoResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface VideoUploadTarget {
  key: string;
  /** "presigned" = PUT to R2. "direct" = POST to the local dev sink (no R2). */
  mode: "presigned" | "direct";
  url: string;
  /** Must be sent as the PUT Content-Type; it is part of the signature. */
  contentType: string;
}

export const UploadTargetInput = z.object({
  kind: z.enum(["video", "poster"]),
  filename: z.string().min(1).max(300),
  size: z.number().int().positive(),
  contentType: z.string().max(200).optional().nullable(),
});

export async function createVideoUploadTarget(
  input: z.infer<typeof UploadTargetInput>
): Promise<VideoResult<VideoUploadTarget>> {
  const parsed = UploadTargetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { kind, filename, size } = parsed.data;

  let key: string;
  let contentType: string;
  if (kind === "video") {
    const ext = extensionOf(filename);
    if (!isVideoExtension(ext)) return { ok: false, error: "bad_type" };
    if (size > MAX_VIDEO_BYTES) return { ok: false, error: "too_large" };
    key = `${VIDEO_KEY_PREFIX}${randomUUID()}.${ext}`;
    contentType = normalizeContentType(parsed.data.contentType);
  } else {
    if (size > MAX_POSTER_BYTES) return { ok: false, error: "too_large" };
    key = `${VIDEO_KEY_PREFIX}posters/${randomUUID()}.jpg`;
    contentType = "image/jpeg";
  }

  const url = await getStorage().presignedPutUrl(key, {
    contentType,
    expiresInSeconds: 3600,
  });
  if (url) return { ok: true, data: { key, mode: "presigned", url, contentType } };
  // Local dev (no R2): the /api/uploads sink takes outreach-video keys from
  // an admin session. It answers 404 as soon as R2 is configured.
  return {
    ok: true,
    data: { key, mode: "direct", url: `/api/uploads?key=${encodeURIComponent(key)}`, contentType },
  };
}

export const CreateVideoInput = z.object({
  videoKey: z.string().min(1).max(300),
  posterKey: z.string().min(1).max(300).optional().nullable(),
  praxisName: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().max(1000).optional().nullable(),
  recipientEmail: z.string().trim().email().max(320).optional().nullable().or(z.literal("")),
  notionPage: z.string().trim().max(500).optional().nullable(),
  durationSeconds: z.number().int().positive().max(24 * 3600).optional().nullable(),
});

export interface CreatedVideo {
  id: string;
  slug: string;
  url: string;
}

function isVideoKey(key: string): boolean {
  return (
    key.startsWith(VIDEO_KEY_PREFIX) &&
    !key.startsWith(`${VIDEO_KEY_PREFIX}posters/`) &&
    !key.includes("..") &&
    isVideoExtension(extensionOf(key))
  );
}

function isPosterKey(key: string): boolean {
  return key.startsWith(`${VIDEO_KEY_PREFIX}posters/`) && !key.includes("..");
}

/** Verify the uploaded object(s) and write the row. */
export async function createOutreachVideo(
  input: z.infer<typeof CreateVideoInput>,
  createdByEmail: string | null
): Promise<VideoResult<CreatedVideo>> {
  const parsed = CreateVideoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  // Only keys this module minted. Without the prefix check a caller could
  // attach any object in the bucket (e.g. a Praxis upload) to a public page.
  if (!isVideoKey(d.videoKey)) return { ok: false, error: "bad_key" };
  if (d.posterKey && !isPosterKey(d.posterKey)) return { ok: false, error: "bad_key" };

  const storage = getStorage();
  const head = await storage.head(d.videoKey);
  if (!head || head.size <= 0) return { ok: false, error: "not_uploaded" };
  const posterKey =
    d.posterKey && (await storage.head(d.posterKey)) ? d.posterKey : null;

  const contentType =
    head.contentType && head.contentType.startsWith("video/")
      ? head.contentType
      : contentTypeForExtension(extensionOf(d.videoKey));

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = newSlug();
    try {
      const rows = await sqlClient<{ id: string }[]>`
        INSERT INTO outreach_videos (
          slug, praxis_name, title, message, recipient_email, notion_page_id,
          storage_key, poster_key, content_type, size_bytes, duration_seconds,
          created_by_email
        ) VALUES (
          ${slug}, ${d.praxisName}, ${d.title || null}, ${d.message || null},
          ${d.recipientEmail || null}, ${normalizeNotionId(d.notionPage)},
          ${d.videoKey}, ${posterKey}, ${contentType}, ${head.size},
          ${d.durationSeconds ?? null}, ${createdByEmail}
        )
        RETURNING id
      `;
      return {
        ok: true,
        data: { id: rows[0]!.id, slug, url: publicVideoUrl(env.VIDEO_PUBLIC_ORIGIN, slug) },
      };
    } catch (err) {
      // 23505 = unique_violation on slug: roll a new one. Anything else is real.
      if ((err as { code?: string }).code !== "23505") throw err;
    }
  }
  return { ok: false, error: "slug_collision" };
}

function contentTypeForExtension(ext: string): string {
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

export async function setOutreachVideoArchived(id: string, archived: boolean): Promise<void> {
  if (!UUID_PATTERN.test(id)) return;
  await sqlClient`
    UPDATE outreach_videos
    SET archived_at = CASE WHEN ${archived} THEN now() ELSE NULL END
    WHERE id = ${id}
  `;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface OutreachVideoStats {
  id: string;
  slug: string;
  url: string;
  praxisName: string;
  title: string | null;
  message: string | null;
  recipientEmail: string | null;
  notionPageId: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  createdAt: Date;
  archivedAt: Date | null;
  /** Page loads, internal ones excluded. */
  opens: number;
  /** Distinct device-days (see viewerHash). */
  viewers: number;
  /** Page loads in which the video was started. */
  plays: number;
  /** Highest milestone any viewer reached (0 if nobody passed 10 %). */
  maxPercent: number;
  /** Mean furthest milestone over page loads that played. Null if none played. */
  avgPercent: number | null;
  ctaClicks: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

interface StatsRow {
  id: string;
  slug: string;
  praxis_name: string;
  title: string | null;
  message: string | null;
  recipient_email: string | null;
  notion_page_id: string | null;
  duration_seconds: number | null;
  size_bytes: number;
  created_at: Date;
  archived_at: Date | null;
  opens: number;
  viewers: number;
  plays: number;
  max_percent: number;
  avg_percent: number | null;
  cta_clicks: number;
  first_seen_at: Date | null;
  last_seen_at: Date | null;
}

function toStats(r: StatsRow): OutreachVideoStats {
  return {
    id: r.id,
    slug: r.slug,
    url: publicVideoUrl(env.VIDEO_PUBLIC_ORIGIN, r.slug),
    praxisName: r.praxis_name,
    title: r.title,
    message: r.message,
    recipientEmail: r.recipient_email,
    notionPageId: r.notion_page_id,
    durationSeconds: r.duration_seconds,
    sizeBytes: Number(r.size_bytes),
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    opens: r.opens,
    viewers: r.viewers,
    plays: r.plays,
    maxPercent: r.max_percent,
    avgPercent: r.avg_percent,
    ctaClicks: r.cta_clicks,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/**
 * One row per video with its aggregates. Sessions (page loads) are folded
 * first so "average watched" is per viewing, not per beacon.
 */
export async function listOutreachVideos(opts: {
  includeArchived?: boolean;
  slug?: string;
  id?: string;
} = {}): Promise<OutreachVideoStats[]> {
  if (opts.id && !UUID_PATTERN.test(opts.id)) return [];
  if (opts.slug && !SLUG_PATTERN.test(opts.slug)) return [];
  const rows = await sqlClient<StatsRow[]>`
    WITH s AS (
      SELECT
        video_id,
        session_id,
        min(viewer_hash) AS viewer_hash,
        bool_or(kind = 'play') AS played,
        bool_or(kind = 'cta') AS cta,
        coalesce(max(percent) FILTER (WHERE kind = 'progress'), 0) AS pct,
        min(created_at) AS first_at,
        max(created_at) AS last_at
      FROM outreach_video_events
      WHERE NOT internal
      GROUP BY video_id, session_id
    ), a AS (
      SELECT
        video_id,
        count(*)::int AS opens,
        count(DISTINCT viewer_hash)::int AS viewers,
        count(*) FILTER (WHERE played)::int AS plays,
        max(pct)::int AS max_percent,
        round(avg(pct) FILTER (WHERE played))::int AS avg_percent,
        count(*) FILTER (WHERE cta)::int AS cta_clicks,
        min(first_at) AS first_seen_at,
        max(last_at) AS last_seen_at
      FROM s
      GROUP BY video_id
    )
    SELECT
      v.id, v.slug, v.praxis_name, v.title, v.message, v.recipient_email,
      v.notion_page_id, v.duration_seconds, v.size_bytes::float8 AS size_bytes,
      v.created_at, v.archived_at,
      coalesce(a.opens, 0) AS opens,
      coalesce(a.viewers, 0) AS viewers,
      coalesce(a.plays, 0) AS plays,
      coalesce(a.max_percent, 0) AS max_percent,
      a.avg_percent,
      coalesce(a.cta_clicks, 0) AS cta_clicks,
      a.first_seen_at,
      a.last_seen_at
    FROM outreach_videos v
    LEFT JOIN a ON a.video_id = v.id
    WHERE (${opts.includeArchived ?? false} OR v.archived_at IS NULL)
      AND (${opts.slug ?? null}::text IS NULL OR v.slug = ${opts.slug ?? null})
      AND (${opts.id ?? null}::uuid IS NULL OR v.id = ${opts.id ?? null})
    ORDER BY v.created_at DESC
    LIMIT 500
  `;
  return rows.map(toStats);
}

export interface OutreachVideoSession {
  sessionId: string;
  viewerHash: string;
  internal: boolean;
  device: string | null;
  played: boolean;
  /** Furthest milestone reached, 0 if under 10 %. */
  percent: number;
  cta: boolean;
  firstAt: Date;
  lastAt: Date;
}

/** Every page load of one video, newest first, internal ones included (flagged). */
export async function listOutreachVideoSessions(videoId: string): Promise<OutreachVideoSession[]> {
  if (!UUID_PATTERN.test(videoId)) return [];
  const rows = await sqlClient<
    {
      session_id: string;
      viewer_hash: string;
      internal: boolean;
      device: string | null;
      played: boolean;
      pct: number;
      cta: boolean;
      first_at: Date;
      last_at: Date;
    }[]
  >`
    SELECT
      session_id,
      min(viewer_hash) AS viewer_hash,
      bool_or(internal) AS internal,
      min(device) AS device,
      bool_or(kind = 'play') AS played,
      coalesce(max(percent) FILTER (WHERE kind = 'progress'), 0)::int AS pct,
      bool_or(kind = 'cta') AS cta,
      min(created_at) AS first_at,
      max(created_at) AS last_at
    FROM outreach_video_events
    WHERE video_id = ${videoId}
    GROUP BY session_id
    ORDER BY min(created_at) DESC
    LIMIT 300
  `;
  return rows.map((r) => ({
    sessionId: r.session_id,
    viewerHash: r.viewer_hash,
    internal: r.internal,
    device: r.device,
    played: r.played,
    percent: r.pct,
    cta: r.cta,
    firstAt: r.first_at,
    lastAt: r.last_at,
  }));
}

/** Presigned (or public) playback URL for the admin preview. */
export async function videoPlaybackUrl(slug: string): Promise<string | null> {
  const pub = await getPublicVideo(slug, { includeArchived: true });
  return pub?.videoUrl ?? null;
}

// ---------------------------------------------------------------------------
// Public watch page
// ---------------------------------------------------------------------------

export interface PublicVideo {
  slug: string;
  praxisName: string;
  title: string | null;
  message: string | null;
  durationSeconds: number | null;
  contentType: string;
  videoUrl: string;
  posterUrl: string | null;
}

export async function getPublicVideo(
  slug: string,
  opts: { includeArchived?: boolean } = {}
): Promise<PublicVideo | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const rows = await sqlClient<
    {
      slug: string;
      praxis_name: string;
      title: string | null;
      message: string | null;
      duration_seconds: number | null;
      content_type: string;
      storage_key: string;
      poster_key: string | null;
    }[]
  >`
    SELECT slug, praxis_name, title, message, duration_seconds, content_type,
           storage_key, poster_key
    FROM outreach_videos
    WHERE slug = ${slug}
      AND (${opts.includeArchived ?? false} OR archived_at IS NULL)
  `;
  const v = rows[0];
  if (!v) return null;
  if (!hasR2()) {
    // Local dev: the stored file is only reachable through the portal, and the
    // watch page runs on another origin, so hand out absolute dev-route URLs.
    const base = `${env.APP_ORIGIN.replace(/\/$/, "")}/api/public/videos/${v.slug}/file`;
    return {
      slug: v.slug,
      praxisName: v.praxis_name,
      title: v.title,
      message: v.message,
      durationSeconds: v.duration_seconds,
      contentType: v.content_type,
      videoUrl: base,
      posterUrl: v.poster_key ? `${base}?part=poster` : null,
    };
  }
  const storage = getStorage();
  const [videoUrl, posterUrl] = await Promise.all([
    storage.urlFor(v.storage_key, { expiresInSeconds: PLAYBACK_URL_TTL_SECONDS }),
    v.poster_key
      ? storage.urlFor(v.poster_key, { expiresInSeconds: PLAYBACK_URL_TTL_SECONDS })
      : Promise.resolve(null),
  ]);
  return {
    slug: v.slug,
    praxisName: v.praxis_name,
    title: v.title,
    message: v.message,
    durationSeconds: v.duration_seconds,
    contentType: v.content_type,
    videoUrl,
    posterUrl,
  };
}

/**
 * Store one beacon. Unknown or archived slugs are dropped silently (the
 * caller answers 204 either way, so the route does not confirm which slugs
 * exist). Duplicates collapse on the dedupe index.
 */
export async function recordVideoEvent(
  slug: string,
  event: VideoEventInput,
  meta: { ip: string | null; userAgent: string | null; at?: Date }
): Promise<boolean> {
  if (!SLUG_PATTERN.test(slug)) return false;
  const at = meta.at ?? new Date();
  const hash = viewerHash(deriveSigningKey("outreach-video-viewer"), meta.ip, meta.userAgent, at);
  const rows = await sqlClient<{ id: string }[]>`
    INSERT INTO outreach_video_events
      (video_id, kind, percent, session_id, viewer_hash, internal, device)
    SELECT id, ${event.k}, ${event.p ?? 0}, ${event.s}, ${hash},
           ${event.i ?? false}, ${deviceFromUserAgent(meta.userAgent)}
    FROM outreach_videos
    WHERE slug = ${slug} AND archived_at IS NULL
    ON CONFLICT (video_id, session_id, kind, percent) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Token API auth
// ---------------------------------------------------------------------------

/**
 * `Authorization: Bearer <VIDEO_API_TOKEN>`. Returns "disabled" when no token
 * is configured, so the route can answer 404 instead of advertising itself.
 */
export function checkVideoApiToken(authorization: string | null): "ok" | "denied" | "disabled" {
  const expected = env.VIDEO_API_TOKEN;
  if (!expected) return "disabled";
  const m = (authorization ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return "denied";
  return constantTimeEqual(m[1]!.trim(), expected) ? "ok" : "denied";
}

/**
 * Local dev only: storage key behind a slug, for the dev file route. Archived
 * videos included so the admin preview keeps working.
 */
export async function localVideoFileKey(
  slug: string,
  part: "video" | "poster"
): Promise<{ key: string; contentType: string } | null> {
  if (hasR2() || !SLUG_PATTERN.test(slug)) return null;
  const rows = await sqlClient<{ storage_key: string; poster_key: string | null; content_type: string }[]>`
    SELECT storage_key, poster_key, content_type FROM outreach_videos WHERE slug = ${slug}
  `;
  const v = rows[0];
  if (!v) return null;
  if (part === "poster") return v.poster_key ? { key: v.poster_key, contentType: "image/jpeg" } : null;
  return { key: v.storage_key, contentType: v.content_type };
}
