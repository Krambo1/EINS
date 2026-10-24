import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, dbApp, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { withdrawOpenApproval } from "@/server/content-approval";
import { getStorage } from "@/server/storage";
import { verifyUploadedObject } from "@/server/uploads";
import { generatePostCode, postCodeFromUtm } from "@/lib/post-code";
import { buildContentLinks, zielseiteOrigin, type ContentLinkMedium } from "@/lib/content-links";
import {
  canPublish,
  isContentStatus,
  type ContentFormat,
  type ContentPlatformName,
  type ContentStatus,
} from "@/lib/content-status";
import {
  checkAdminMove,
  checkPermalink,
  emptyTally,
  isEditableStatus,
  summarizePublications,
  tallyInquiries,
  type InquiryTally,
} from "@/lib/content-items";
import {
  UPLOAD_IMAGE_EXTENSIONS,
  UPLOAD_VIDEO_EXTENSIONS,
  fileExtension,
  uploadLimitForExtension,
} from "@/lib/uploads";
import { can } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * Posts (Beiträge): admin writes on the superuser handle, Praxis reads
 * through RLS (withClinicContext). Every write enforces the status rules of
 * lib/content-status.ts and lib/content-items.ts here, not only in the UI:
 *   - EINS never sets freigegeben/aenderung, zur_freigabe only through the
 *     Freigabe-Paket (server/content-approval.ts), live only through a
 *     publication;
 *   - a publication needs canPublish(status) and sets the post live;
 *   - gestoppt needs a reason and closes every open publication.
 * Queries are per Praxis; the cross-Praxis overview caps per Praxis.
 */

/** Rule or input violation; the message is shown to the admin as is. */
export class ContentRuleError extends Error {}

type Handle = typeof dbApp;
type AdminActor = { email: string };

const CODE_ATTEMPTS = 5;
const UNKNOWN_CODE_DAYS = 90;
const UNKNOWN_CODE_ROW_CAP = 5000;
export const OVERVIEW_PER_CLINIC = 50;

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

async function clinicOrigin(clinicId: string): Promise<{ origin: string | null }> {
  const [clinic] = await db
    .select({ reviewLandingOrigin: schema.clinics.reviewLandingOrigin })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new ContentRuleError("Praxis nicht gefunden.");
  return { origin: zielseiteOrigin(clinic.reviewLandingOrigin) };
}

async function assertTreatment(clinicId: string, treatmentId: string | null): Promise<void> {
  if (!treatmentId) return;
  const [row] = await db
    .select({ id: schema.treatments.id })
    .from(schema.treatments)
    .where(and(eq(schema.treatments.id, treatmentId), eq(schema.treatments.clinicId, clinicId)))
    .limit(1);
  if (!row) throw new ContentRuleError("Die Behandlung gehört nicht zu dieser Praxis.");
}

async function assertAsset(clinicId: string, assetId: string | null): Promise<void> {
  if (!assetId) return;
  const [row] = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.clinicId, clinicId)))
    .limit(1);
  if (!row) throw new ContentRuleError("Die Datei gehört nicht zu dieser Praxis.");
}

async function upsertLinks(
  tx: Handle,
  item: { id: string; clinicId: string; code: string },
  origin: string
): Promise<void> {
  const links = buildContentLinks(origin, item.code);
  await tx
    .insert(schema.contentLinks)
    .values(links.map((l) => ({ contentItemId: item.id, clinicId: item.clinicId, medium: l.medium, url: l.url })))
    .onConflictDoUpdate({
      target: [schema.contentLinks.contentItemId, schema.contentLinks.medium],
      set: { url: sql`excluded.url` },
    });
}

async function loadItemForWrite(clinicId: string, id: string) {
  const [item] = await db
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.id, id), eq(schema.contentItems.clinicId, clinicId)))
    .limit(1);
  if (!item) throw new ContentRuleError("Beitrag nicht gefunden.");
  if (!isContentStatus(item.status)) throw new ContentRuleError("Unbekannter Status.");
  return { ...item, status: item.status as ContentStatus };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface ContentItemFields {
  title: string;
  format: ContentFormat;
  treatmentId: string | null;
  usesClone: boolean;
  aiContent: boolean;
  caption: string | null;
  assetId: string | null;
}

export interface CreateContentItemInput extends ContentItemFields {
  clinicId: string;
  /**
   * A file the admin just uploaded (server/uploads.ts flow, scope "assets").
   * Creates the assets row together with the post and notifies the Praxis.
   */
  upload?: { key: string; filename: string } | null;
}

const ASSET_VIDEO_EXT: readonly string[] = UPLOAD_VIDEO_EXTENSIONS;
const ASSET_IMAGE_EXT: readonly string[] = UPLOAD_IMAGE_EXTENSIONS;

/** Extensions an admin may upload as a post file. */
export function isAssetUploadExtension(ext: string): boolean {
  return ASSET_VIDEO_EXT.includes(ext) || ASSET_IMAGE_EXT.includes(ext);
}

export function assetKeyPrefix(clinicId: string): string {
  return `${clinicId}/assets/`;
}

async function verifyAssetUpload(clinicId: string, key: string) {
  if (!key.startsWith(assetKeyPrefix(clinicId)) || key.includes("..")) {
    throw new ContentRuleError("Die hochgeladene Datei gehört nicht zu dieser Praxis.");
  }
  const ext = fileExtension(key);
  const head = await verifyUploadedObject(key);
  if (!head) throw new ContentRuleError("Die Datei ist nicht vollständig angekommen. Bitte erneut hochladen.");
  if (!isAssetUploadExtension(ext) || head.size > uploadLimitForExtension(ext)) {
    await getStorage()
      .remove(key)
      .catch(() => undefined);
    throw new ContentRuleError("Nur Videos (bis 2 GB) und Bilder (bis 100 MB) sind erlaubt.");
  }
  const [dup] = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(eq(schema.assets.clinicId, clinicId), eq(schema.assets.storageKey, key)))
    .limit(1);
  if (dup) throw new ContentRuleError("Diese Datei ist schon angelegt.");
  return { kind: ASSET_VIDEO_EXT.includes(ext) ? "video" : "foto", size: head.size, contentType: head.contentType ?? null };
}

export async function createContentItem(
  admin: AdminActor,
  input: CreateContentItemInput
): Promise<{ id: string; code: string; linksBuilt: boolean; assetId: string | null }> {
  const { origin } = await clinicOrigin(input.clinicId);
  await assertTreatment(input.clinicId, input.treatmentId);
  if (input.upload && input.assetId) {
    throw new ContentRuleError("Bitte entweder eine vorhandene Datei wählen oder eine neue hochladen.");
  }
  await assertAsset(input.clinicId, input.assetId);
  const upload = input.upload ? await verifyAssetUpload(input.clinicId, input.upload.key) : null;

  const created = await db.transaction(async (tx) => {
    let assetId = input.assetId;
    if (upload && input.upload) {
      const [asset] = await tx
        .insert(schema.assets)
        .values({
          clinicId: input.clinicId,
          kind: upload.kind,
          title: input.title,
          storageKey: input.upload.key,
          mimeType: upload.contentType,
          fileSizeBytes: upload.size,
        })
        .returning({ id: schema.assets.id });
      assetId = asset!.id;
    }

    for (let attempt = 1; ; attempt++) {
      const code = generatePostCode();
      try {
        // Savepoint: a code collision rolls back only this insert.
        const row = await tx.transaction(async (sp) => {
          const [r] = await sp
            .insert(schema.contentItems)
            .values({
              clinicId: input.clinicId,
              code,
              title: input.title,
              format: input.format,
              treatmentId: input.treatmentId,
              usesClone: input.usesClone,
              aiContent: input.aiContent,
              caption: input.caption,
              assetId,
              createdBy: admin.email,
            })
            .returning({ id: schema.contentItems.id, code: schema.contentItems.code });
          return r!;
        });
        if (origin) await upsertLinks(tx as unknown as Handle, { id: row.id, clinicId: input.clinicId, code: row.code }, origin);
        return { id: row.id, code: row.code, assetId };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
      }
    }
  });

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "content_item",
    entityId: created.id,
    diff: {
      code: created.code,
      title: input.title,
      format: input.format,
      usesClone: input.usesClone,
      aiContent: input.aiContent,
      assetId: created.assetId,
      uploaded: Boolean(upload),
    },
  });
  if (upload && created.assetId) {
    await writeAudit({
      clinicId: input.clinicId,
      actorEmail: admin.email,
      action: "upload",
      entityKind: "asset",
      entityId: created.assetId,
      diff: { kind: upload.kind, sizeBytes: upload.size, contentItemId: created.id },
    });
    await notifyAssetReady(input.clinicId);
  }
  return { id: created.id, code: created.code, linksBuilt: Boolean(origin), assetId: created.assetId };
}

/** In-app bell "asset_ready" for every active Praxis user who may see Medien. Best effort. */
async function notifyAssetReady(clinicId: string): Promise<void> {
  try {
    const users = await db
      .select({ id: schema.clinicUsers.id, role: schema.clinicUsers.role })
      .from(schema.clinicUsers)
      .where(and(eq(schema.clinicUsers.clinicId, clinicId), isNull(schema.clinicUsers.archivedAt)));
    const recipients = users.filter((u) => can(u.role as Role, "assets.view"));
    if (recipients.length === 0) return;
    await db.insert(schema.notifications).values(
      recipients.map((u) => ({
        userId: u.id,
        clinicId,
        kind: "asset_ready",
        title: "Neue Datei unter Medien",
        body: "EINS hat eine neue Datei für Ihren nächsten Beitrag unter Medien abgelegt.",
        link: "/medien",
      }))
    );
  } catch (err) {
    console.error("[content] asset_ready notification failed:", err instanceof Error ? err.name : "unknown");
  }
}

// ---------------------------------------------------------------------------
// Update, status, publications, stop, links
// ---------------------------------------------------------------------------

export async function updateContentItem(
  admin: AdminActor,
  input: ContentItemFields & { clinicId: string; id: string }
): Promise<void> {
  const item = await loadItemForWrite(input.clinicId, input.id);
  if (!isEditableStatus(item.status)) {
    throw new ContentRuleError("Bearbeiten geht nur im Entwurf oder wenn die Praxis eine Änderung wünscht.");
  }
  await assertTreatment(input.clinicId, input.treatmentId);
  await assertAsset(input.clinicId, input.assetId);
  const captionChanged = (item.caption ?? null) !== input.caption;

  const [row] = await db
    .update(schema.contentItems)
    .set({
      title: input.title,
      format: input.format,
      treatmentId: input.treatmentId,
      usesClone: input.usesClone,
      aiContent: input.aiContent,
      caption: input.caption,
      assetId: input.assetId,
      // A new caption needs a new HWG check (Freigabe-Schranke, Phase 4);
      // an acknowledgement belonged to the old check.
      ...(captionChanged ? { hwgCheckId: null, hwgWarningsAckBy: null, hwgWarningsAckAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.contentItems.id, item.id),
        eq(schema.contentItems.clinicId, input.clinicId),
        inArray(schema.contentItems.status, ["entwurf", "aenderung"])
      )
    )
    .returning({ id: schema.contentItems.id });
  if (!row) throw new ContentRuleError("Der Beitrag hat sich inzwischen geändert. Bitte neu laden.");

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "content_item",
    entityId: item.id,
    diff: {
      title: { from: item.title, to: input.title },
      format: { from: item.format, to: input.format },
      usesClone: { from: item.usesClone, to: input.usesClone },
      aiContent: { from: item.aiContent, to: input.aiContent },
      captionChanged,
    },
  });
}

export async function moveContentStatus(
  admin: AdminActor,
  input: { clinicId: string; id: string; to: ContentStatus; reason?: string | null }
): Promise<void> {
  if (input.to === "gestoppt") {
    await stopContentItem(admin, { clinicId: input.clinicId, id: input.id, reason: input.reason ?? "" });
    return;
  }
  const item = await loadItemForWrite(input.clinicId, input.id);
  const error = checkAdminMove(item.status, input.to, input.reason);
  if (error) throw new ContentRuleError(error);

  // Pulling a waiting post back to Entwurf withdraws its open approval in the
  // same transaction (the link and the portal buttons stop working).
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(schema.contentItems)
      .set({ status: input.to, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentItems.id, item.id),
          eq(schema.contentItems.clinicId, input.clinicId),
          eq(schema.contentItems.status, item.status)
        )
      )
      .returning({ id: schema.contentItems.id });
    if (r && item.status === "zur_freigabe") await withdrawOpenApproval(tx, item.id);
    return r;
  });
  if (!row) throw new ContentRuleError("Der Beitrag hat sich inzwischen geändert. Bitte neu laden.");

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "transition",
    entityKind: "content_item",
    entityId: item.id,
    diff: { status: { from: item.status, to: input.to } },
  });
}

export async function addPublication(
  admin: AdminActor,
  input: { clinicId: string; id: string; platform: ContentPlatformName; permalink: string; publishedAt: Date }
): Promise<void> {
  const item = await loadItemForWrite(input.clinicId, input.id);
  if (!canPublish(item.status)) {
    throw new ContentRuleError("Ein Permalink geht erst, wenn die Praxis den Beitrag freigegeben hat.");
  }
  if (item.stopRequestedAt) {
    throw new ContentRuleError("Dieser Beitrag ist nach einem Widerruf zu stoppen und darf nicht mehr veröffentlicht werden.");
  }
  const link = checkPermalink(input.platform, input.permalink);
  if (!link.ok) throw new ContentRuleError(link.error);

  try {
    await db.transaction(async (tx) => {
      // Lock the post so a parallel stop cannot slip between check and insert.
      const [locked] = await tx
        .select({ status: schema.contentItems.status })
        .from(schema.contentItems)
        .where(and(eq(schema.contentItems.id, item.id), eq(schema.contentItems.clinicId, input.clinicId)))
        .for("update");
      if (!locked || !isContentStatus(locked.status) || !canPublish(locked.status)) {
        throw new ContentRuleError("Der Beitrag hat sich inzwischen geändert. Bitte neu laden.");
      }
      await tx.insert(schema.contentPublications).values({
        contentItemId: item.id,
        clinicId: input.clinicId,
        platform: input.platform,
        permalink: link.url,
        publishedAt: input.publishedAt,
        publishedBy: "manuell",
      });
      await tx
        .update(schema.contentItems)
        .set({ status: "live", updatedAt: new Date() })
        .where(eq(schema.contentItems.id, item.id));
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ContentRuleError("Dieser Permalink ist schon eingetragen.");
    throw err;
  }

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "content_publication",
    entityId: item.id,
    diff: {
      platform: input.platform,
      permalink: link.url,
      publishedAt: input.publishedAt.toISOString(),
      status: { from: item.status, to: "live" },
    },
  });
}

export async function stopContentItem(
  admin: AdminActor,
  input: { clinicId: string; id: string; reason: string }
): Promise<void> {
  const reason = input.reason.trim();
  const item = await loadItemForWrite(input.clinicId, input.id);
  const error = checkAdminMove(item.status, "gestoppt", reason);
  if (error) throw new ContentRuleError(error);

  const stopped = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.contentItems)
      .set({ status: "gestoppt", stopReason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentItems.id, item.id),
          eq(schema.contentItems.clinicId, input.clinicId),
          eq(schema.contentItems.status, item.status)
        )
      )
      .returning({ id: schema.contentItems.id });
    if (!row) return null;
    // A stopped post no longer waits for the Praxis.
    if (item.status === "zur_freigabe") await withdrawOpenApproval(tx, item.id);
    return tx
      .update(schema.contentPublications)
      .set({ stoppedAt: sql`now()` })
      .where(and(eq(schema.contentPublications.contentItemId, item.id), isNull(schema.contentPublications.stoppedAt)))
      .returning({ id: schema.contentPublications.id });
  });
  if (!stopped) throw new ContentRuleError("Der Beitrag hat sich inzwischen geändert. Bitte neu laden.");

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "transition",
    entityKind: "content_item",
    entityId: item.id,
    diff: { status: { from: item.status, to: "gestoppt" }, reason, publicationsStopped: stopped.length },
  });
}

export async function regenerateLinks(admin: AdminActor, input: { clinicId: string; id: string }): Promise<void> {
  const item = await loadItemForWrite(input.clinicId, input.id);
  const { origin } = await clinicOrigin(input.clinicId);
  if (!origin) throw new ContentRuleError("Zielseiten-Adresse fehlt (Stammdaten: Zielseiten-Origin)");
  await upsertLinks(db as unknown as Handle, { id: item.id, clinicId: input.clinicId, code: item.code }, origin);
  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "content_item",
    entityId: item.id,
    diff: { links: "neu erzeugt", origin },
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ContentPublicationView {
  id: string;
  platform: string;
  permalink: string;
  publishedAt: Date;
  stoppedAt: Date | null;
}

export interface ContentItemView {
  id: string;
  code: string;
  title: string;
  format: string;
  status: ContentStatus;
  usesClone: boolean;
  aiContent: boolean;
  caption: string | null;
  stopReason: string | null;
  treatmentId: string | null;
  treatmentName: string | null;
  assetId: string | null;
  assetTitle: string | null;
  assetStorageKey: string | null;
  /** True when the post file is a video (asset kind or mime type), for the preview player. */
  assetIsVideo: boolean;
  createdAt: Date;
  updatedAt: Date;
  publications: ContentPublicationView[];
  links: Array<{ medium: ContentLinkMedium; url: string }>;
  liveSince: Date | null;
  stoppedAt: Date | null;
  inquiries: InquiryTally;
}

async function loadItems(h: Handle, clinicId: string, opts: { hideDrafts: boolean }): Promise<ContentItemView[]> {
  const where = opts.hideDrafts
    ? and(eq(schema.contentItems.clinicId, clinicId), ne(schema.contentItems.status, "entwurf"))
    : eq(schema.contentItems.clinicId, clinicId);
  const items = await h
    .select({
      item: schema.contentItems,
      treatmentName: schema.treatments.name,
      assetTitle: schema.assets.title,
      assetStorageKey: schema.assets.storageKey,
      assetKind: schema.assets.kind,
      assetMime: schema.assets.mimeType,
    })
    .from(schema.contentItems)
    .leftJoin(schema.treatments, eq(schema.contentItems.treatmentId, schema.treatments.id))
    .leftJoin(schema.assets, eq(schema.contentItems.assetId, schema.assets.id))
    .where(where)
    .orderBy(desc(schema.contentItems.createdAt));
  if (items.length === 0) return [];

  const [pubs, links, counts] = await Promise.all([
    h
      .select()
      .from(schema.contentPublications)
      .where(eq(schema.contentPublications.clinicId, clinicId))
      .orderBy(asc(schema.contentPublications.publishedAt)),
    h.select().from(schema.contentLinks).where(eq(schema.contentLinks.clinicId, clinicId)),
    h
      .select({
        contentItemId: sql<string>`${schema.requests.contentItemId}`,
        source: schema.requests.source,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          isNotNull(schema.requests.contentItemId),
          ne(schema.requests.status, "spam")
        )
      )
      .groupBy(schema.requests.contentItemId, schema.requests.source),
  ]);

  const tallies = tallyInquiries(counts);
  const linkOrder = ["profil_link", "dm", "story_link", "organisch"];

  return items.map(({ item, treatmentName, assetTitle, assetStorageKey, assetKind, assetMime }) => {
    const status = (isContentStatus(item.status) ? item.status : "entwurf") as ContentStatus;
    const itemPubs = pubs
      .filter((p) => p.contentItemId === item.id)
      .map((p) => ({
        id: p.id,
        platform: p.platform,
        permalink: p.permalink,
        publishedAt: p.publishedAt,
        stoppedAt: p.stoppedAt,
      }));
    const summary = summarizePublications(status, item.updatedAt, itemPubs);
    return {
      id: item.id,
      code: item.code,
      title: item.title,
      format: item.format,
      status,
      usesClone: item.usesClone,
      aiContent: item.aiContent,
      caption: item.caption,
      stopReason: item.stopReason,
      treatmentId: item.treatmentId,
      treatmentName: treatmentName ?? null,
      assetId: item.assetId,
      assetTitle: assetTitle ?? null,
      assetStorageKey: assetStorageKey ?? null,
      assetIsVideo: assetKind === "video" || (assetMime ?? "").startsWith("video/"),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      publications: itemPubs,
      links: links
        .filter((l) => l.contentItemId === item.id)
        .sort((a, b) => linkOrder.indexOf(a.medium) - linkOrder.indexOf(b.medium))
        .map((l) => ({ medium: l.medium as ContentLinkMedium, url: l.url })),
      liveSince: summary.liveSince,
      stoppedAt: summary.stoppedAt,
      inquiries: tallies.get(item.id) ?? emptyTally(),
    };
  });
}

/** All posts of one Praxis for the admin tab (superuser handle, explicit clinic filter). */
export async function listContentItemsForAdmin(clinicId: string): Promise<ContentItemView[]> {
  return loadItems(db as unknown as Handle, clinicId, { hideDrafts: false });
}

/** Posts the Praxis sees on /beitraege: through RLS, without drafts. */
export async function listContentItemsForPractice(clinicId: string, userId: string): Promise<ContentItemView[]> {
  return withClinicContext(clinicId, userId, (tx) => loadItems(tx, clinicId, { hideDrafts: true }), "beitraege:list");
}

/** Treatments and post files for the admin form selects. */
export async function contentFormOptions(clinicId: string) {
  const [treatments, assets, clinic] = await Promise.all([
    db
      .select({ id: schema.treatments.id, name: schema.treatments.name, isActive: schema.treatments.isActive })
      .from(schema.treatments)
      .where(eq(schema.treatments.clinicId, clinicId))
      .orderBy(asc(schema.treatments.displayOrder), asc(schema.treatments.name)),
    db
      .select({ id: schema.assets.id, title: schema.assets.title, kind: schema.assets.kind, createdAt: schema.assets.createdAt })
      .from(schema.assets)
      .where(and(eq(schema.assets.clinicId, clinicId), inArray(schema.assets.kind, ["video", "foto"])))
      .orderBy(desc(schema.assets.createdAt))
      .limit(200),
    clinicOrigin(clinicId),
  ]);
  return { treatments, assets, zielseiteOrigin: clinic.origin };
}

export interface UnknownPostCode {
  code: string;
  count: number;
  lastAt: Date;
}

/**
 * Requests of one Praxis (last 90 days) whose utm_content is a post code
 * that no post of this Praxis resolved at intake. isPostCode decides, the
 * same test the intake uses.
 */
export async function listUnknownPostCodes(clinicId: string): Promise<UnknownPostCode[]> {
  const since = new Date(Date.now() - UNKNOWN_CODE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ utm: schema.requests.utm, createdAt: schema.requests.createdAt })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        isNull(schema.requests.contentItemId),
        gte(schema.requests.createdAt, since),
        sql`${schema.requests.utm} ->> 'utm_content' IS NOT NULL`
      )
    )
    .orderBy(desc(schema.requests.createdAt))
    .limit(UNKNOWN_CODE_ROW_CAP);
  const byCode = new Map<string, UnknownPostCode>();
  for (const r of rows) {
    const code = postCodeFromUtm(r.utm);
    if (!code) continue;
    const cur = byCode.get(code);
    if (cur) cur.count += 1;
    else byCode.set(code, { code, count: 1, lastAt: r.createdAt });
  }
  return [...byCode.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

export interface ContentOverviewRow {
  id: string;
  clinicId: string;
  clinicName: string;
  code: string;
  title: string;
  status: string;
  updatedAt: Date;
}

/** Posts across Praxen for /admin/beitraege, at most OVERVIEW_PER_CLINIC newest per Praxis. */
export async function listContentOverview(): Promise<ContentOverviewRow[]> {
  const c = schema.contentItems;
  const ranked = db
    .select({
      id: c.id,
      clinicId: c.clinicId,
      code: c.code,
      title: c.title,
      status: c.status,
      updatedAt: c.updatedAt,
      rn: sql<number>`row_number() over (partition by ${c.clinicId} order by ${c.updatedAt} desc, ${c.id} desc)`.as("rn"),
    })
    .from(c)
    .as("ranked");
  const rows = await db
    .select({
      id: ranked.id,
      clinicId: ranked.clinicId,
      clinicName: schema.clinics.displayName,
      code: ranked.code,
      title: ranked.title,
      status: ranked.status,
      updatedAt: ranked.updatedAt,
    })
    .from(ranked)
    .innerJoin(schema.clinics, eq(schema.clinics.id, ranked.clinicId))
    .where(sql`${ranked.rn} <= ${OVERVIEW_PER_CLINIC}`)
    .orderBy(desc(ranked.updatedAt));
  return rows;
}
