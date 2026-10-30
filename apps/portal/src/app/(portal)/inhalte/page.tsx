import { requirePermissionOrRedirect } from "@/auth/guards";
import { listContentItemsForPractice, type ContentItemView } from "@/server/content";
import { listApprovalsForPractice, type PracticeApprovalView } from "@/server/content-approval";
import { listAssets } from "@/server/queries/assets";
import { getClinicHeader } from "@/server/queries/clinic";
import { getStorage } from "@/server/storage";
import { canDecideApproval } from "@/lib/content-gate";
import { formatApprovalDue } from "@/lib/content-approval";
import { CONTENT_FORMAT_LABELS, type ContentFormat } from "@/lib/content-status";
import type { AssetKind } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/formatting";
import { PageHeader } from "../_components/PageHeader";
import { FreigabeCard } from "./_components/FreigabeCard";
import { PostsCard } from "./_components/PostsCard";
import { entryName } from "./_lib/zip";
import type { PostFile, PostRow, WaitingPost } from "./_lib/view";

export const metadata = { title: "Inhalte" };

/** Signed file links live as long as someone may keep the page open. */
const LINK_SECONDS = 60 * 60;

const PLATFORM_LABELS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

// The database still allows four kinds (CHECK constraint). New files are
// videos or images.
const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  video: "Video",
  foto: "Bild",
  rohmaterial: "Weiteres Material",
  behind_scenes: "Weiteres Material",
};

function formatLabel(f: string): string {
  return CONTENT_FORMAT_LABELS[f as ContentFormat] ?? f;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} GB`;
}

/** "2 Formular · 1 Anruf": the Anfragen of one post by channel. */
function channelsOf(item: ContentItemView): string | null {
  const q = item.inquiries;
  const parts = [
    q.formular > 0 ? `${formatNumber(q.formular)} Formular` : null,
    q.anruf > 0 ? `${formatNumber(q.anruf)} Anruf` : null,
    q.buchung > 0 ? `${formatNumber(q.buchung)} Buchung` : null,
    q.ohne > 0 ? `${formatNumber(q.ohne)} sonstige` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Who decided a post and when (ContentStudio's approval record). */
function decisionOf(a: PracticeApprovalView | null): string | null {
  if (!a?.decision) return null;
  const what = a.decision.decision === "freigegeben" ? "Freigegeben" : "Änderung gewünscht";
  const how =
    a.decision.decidedVia === "link"
      ? "über den Link in der E-Mail"
      : a.decidedByName
        ? `von ${a.decidedByName}`
        : "im Portal";
  return `${what} am ${formatDate(a.decision.decidedAt)} ${how}`;
}

/**
 * Inhalte: everything EINS makes for the Praxis on one page, in the order the
 * Praxis needs it. First what waits for its decision, then every post with
 * its state, the Anfragen it brought and its file to view and download.
 * Replaces the former pages Beiträge and Medien (both redirect here); the
 * Medien card is part of "Alle Beiträge" since every file belongs to a post
 * (Karam, 2026-10-30). Drafts stay with EINS and are not listed.
 */
export default async function InhaltePage() {
  const session = await requirePermissionOrRedirect("assets.view");

  const [items, approvals, assets, clinic] = await Promise.all([
    listContentItemsForPractice(session.clinicId, session.userId),
    listApprovalsForPractice(session.clinicId, session.userId),
    listAssets(session.clinicId, session.userId),
    getClinicHeader(session.clinicId),
  ]);
  const storage = getStorage();
  const sign = (key: string) => storage.urlFor(key, { expiresInSeconds: LINK_SECONDS });
  const assetById = new Map(assets.map((a) => [a.id, a]));

  /** A post's file with its picture and facts; a superseded file keeps only its link. */
  const fileOf = async (i: ContentItemView): Promise<PostFile | null> => {
    if (!i.assetStorageKey) return null;
    const a = i.assetId ? assetById.get(i.assetId) : undefined;
    const key = i.assetStorageKey;
    const isVideo = a ? a.kind === "video" || (a.mimeType ?? "").startsWith("video/") : i.assetIsVideo;
    const url = await sign(key);
    const facts = [
      a ? (ASSET_KIND_LABELS[a.kind as AssetKind] ?? a.kind) : isVideo ? "Video" : "Bild",
      a?.fileSizeBytes != null ? formatFileSize(a.fileSizeBytes) : null,
      a?.supersedesId ? `Fassung ${a.version}` : null,
    ].filter(Boolean);
    return {
      url,
      downloadUrl: await storage.urlFor(key, {
        expiresInSeconds: LINK_SECONDS,
        downloadName: entryName(i.title, key, a?.mimeType ?? null),
      }),
      thumbUrl: a?.muxPlaybackId
        ? `https://image.mux.com/${a.muxPlaybackId}/thumbnail.jpg?time=1`
        : isVideo
          ? null
          : url,
      isVideo,
      facts: facts.join(" · "),
    };
  };

  // Posts this person can decide first; the ones only the Inhaber:in may approve after them.
  const decidable = (i: ContentItemView) => {
    const a = approvals.get(i.id);
    return !!a && !a.decision && canDecideApproval(session.role, a.inhaberOnly);
  };
  const waitingItems = items
    .filter((i) => i.status === "zur_freigabe")
    .sort((a, b) => Number(decidable(b)) - Number(decidable(a)));

  const waiting: WaitingPost[] = await Promise.all(
    waitingItems.map(async (i) => {
      const a = approvals.get(i.id) ?? null;
      return {
        id: i.id,
        title: i.title,
        formatLabel: formatLabel(i.format),
        treatment: i.treatmentName,
        usesClone: i.usesClone,
        caption: i.caption,
        preview: i.assetStorageKey ? { url: await sign(i.assetStorageKey), isVideo: i.assetIsVideo } : null,
        approvalId: a?.id ?? null,
        dueLabel: a && !a.decision ? formatApprovalDue(a.dueAt) : null,
        decided: !!a?.decision,
        inhaberOnly: a?.inhaberOnly ?? i.usesClone,
        canDecide: !!a && canDecideApproval(session.role, a.inhaberOnly),
      };
    })
  );

  const posts: PostRow[] = await Promise.all(items.map(async (i) => {
    const a = approvals.get(i.id) ?? null;
    const online = i.status === "live" || i.status === "gestoppt";
    const since =
      i.status === "live" && i.liveSince
        ? i.liveSince
        : i.status === "gestoppt" && i.stoppedAt
          ? i.stoppedAt
          : i.updatedAt;
    return {
      id: i.id,
      title: i.title,
      format: i.format,
      formatLabel: formatLabel(i.format),
      status: i.status,
      file: await fileOf(i),
      since: formatDate(since),
      anfragen: online ? i.inquiries.total : null,
      channels: online ? channelsOf(i) : null,
      changeText: i.status === "aenderung" ? (a?.decision?.changeText ?? null) : null,
      decision: decisionOf(a),
      stopReason: i.status === "gestoppt" ? i.stopReason : null,
      caption: i.caption,
      links: i.publications.map((p) => ({
        label: `Auf ${PLATFORM_LABELS[p.platform] ?? p.platform} ansehen`,
        href: p.permalink,
      })),
      dueLabel: i.status === "zur_freigabe" && a && !a.decision ? formatApprovalDue(a.dueAt) : null,
      waiting: i.status === "zur_freigabe",
    };
  }));

  const practiceName = clinic?.displayName || "Ihre Praxis";

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="Inhalte" />
      <FreigabeCard
        posts={waiting}
        practice={{ name: practiceName, logoUrl: clinic?.logoUrl ?? null }}
      />
      <PostsCard rows={posts} practiceName={practiceName} />
    </div>
  );
}
