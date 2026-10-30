import type { ReactNode } from "react";
import { desc, eq } from "drizzle-orm";
import { Download, FileText } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { listDocuments, listVisibleDocumentKinds } from "@/server/queries/documents";
import { getStorage } from "@/server/storage";
import { formatDate } from "@/lib/formatting";
import { can } from "@/lib/roles";
import { DOCUMENT_KIND_LABELS, DOCUMENT_KINDS, type DocumentKind, type Role } from "@/lib/constants";
import { fileExtension, isVideoExtension } from "@/lib/uploads";
import { CONTROL, CONTROL_SQUARE, RAISED_CONTROL } from "../dashboard/_components/dash-ui";
import { PageHeader } from "../_components/PageHeader";
import {
  FileRow,
  FileTypeIcon,
  FilesCard,
  FootHint,
  MetaFacts,
  NewMark,
  PinnedIcons,
  SeenStatus,
  formatFileSize,
} from "./_components/file-ui";
import { KindFilter } from "./_components/KindFilter";
import { FileListCount, FileListPager, FileListRows, FileListState } from "./_components/FileList";
import { DeleteFileButton } from "./_components/DeleteFileButton";
import { NoteSignal } from "./_components/NoteSignal";
import { FilePreview, type PreviewItem } from "./_components/FilePreview";
import { SendArea, SendFilesButton } from "./_components/SendFiles";
import { DownloadAllFiles } from "./_components/DownloadAllFiles";
import { PINNED_DOCS, documentFileName } from "./_lib/von-eins";

export const metadata = { title: "Dateien" };

type Search = { kind?: string; von?: string; an?: string };

/** A file from EINS counts as "Neu" this many days. */
const NEW_DAYS = 7;
/** A sent file lights up once on the render right after "Senden". */
const FRESH_SECONDS = 20;
/** Pictures the browser shows in the preview (no HEIC). */
const PREVIEW_IMAGES = ["png", "jpg", "jpeg", "webp", "gif"];

/**
 * Dateien: everything between the Praxis and EINS in one place (Karam,
 * 2026-10-29, merging Dokumente and "Dateien an EINS"). Two cards, one per
 * direction, so a Praxis sees at a glance what it got and what it sent:
 * "Von EINS" (Verträge, Auswertungen, Leitfäden, the Anleitung) and
 * "An EINS gesendet". From xl they stand side by side at one height; below
 * they stack, "Von EINS" first. Each card carries its own control in its
 * header: the Art filter, "Dateien senden". Files dragged onto the page or
 * pasted go to "An EINS gesendet" (SendArea). /dokumente and /dateien's old
 * upload page both land here.
 *
 * Every row of both cards is rendered here once; pages and the Art filter
 * switch in the browser (FileListState), so "Weiter" and a new Art show at
 * once instead of rendering the whole page again on the server.
 */
export default async function DateienPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // Any role with "documents.view.marketing" can open this page; per-document
  // visibility is filtered below.
  const session = await requirePermissionOrRedirect("documents.view.marketing");
  const role = session.role as Role;
  const canSend = can(role, "uploads.send");
  const params = await searchParams;
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(params.kind ?? "")
    ? (params.kind as DocumentKind)
    : undefined;

  const [docs, kinds, uploads] = await Promise.all([
    // All documents: the Art filter works in the browser.
    listDocuments(session.clinicId, session.userId, role),
    // Only kinds this role can see documents in: Verträge and the AVV are
    // inhaber-only, so other roles never get a choice that shows nothing.
    listVisibleDocumentKinds(session.clinicId, session.userId, role),
    canSend
      ? withClinicContext(session.clinicId, session.userId, (tx) =>
          tx
            .select({
              id: schema.clientUploads.id,
              storageKey: schema.clientUploads.storageKey,
              originalFilename: schema.clientUploads.originalFilename,
              sizeBytes: schema.clientUploads.sizeBytes,
              note: schema.clientUploads.note,
              createdAt: schema.clientUploads.createdAt,
              seenAt: schema.clientUploads.seenAt,
              uploaderName: schema.clinicUsers.fullName,
              uploaderEmail: schema.clinicUsers.email,
            })
            .from(schema.clientUploads)
            .leftJoin(schema.clinicUsers, eq(schema.clientUploads.uploadedBy, schema.clinicUsers.id))
            .where(eq(schema.clientUploads.clinicId, session.clinicId))
            .orderBy(desc(schema.clientUploads.createdAt))
        )
      : Promise.resolve([]),
  ]);

  const storage = getStorage();

  // "Von EINS": the two product PDFs on top (only without a filter: no Art),
  // then the Praxis's documents, newest first.
  type FromRow = {
    key: string;
    kind: DocumentKind | null;
    icon: ReactNode;
    name: string;
    href: string;
    downloadHref: string;
    downloadName: string;
    meta: ReactNode[];
  };
  // Request time, for "Neu" and the fresh wash (the page renders per request).
  const now = Date.now();
  const pinned: FromRow[] = PINNED_DOCS.map((d) => {
    const Icon = PinnedIcons[d.key];
    return {
      key: d.key,
      kind: null,
      icon: <Icon className="h-4 w-4" />,
      name: d.title,
      href: d.href,
      downloadHref: d.href,
      downloadName: d.downloadName,
      meta: [d.label, "PDF"],
    };
  });
  const documentRows: FromRow[] = await Promise.all(
    docs.map(async (d) => {
      const kindLabel = DOCUMENT_KIND_LABELS[d.kind as DocumentKind] ?? d.kind;
      const valid =
        d.validFrom || d.validTo
          ? [d.validFrom && `gültig ab ${formatDate(d.validFrom)}`, d.validTo && `bis ${formatDate(d.validTo)}`]
              .filter(Boolean)
              .join(" ")
          : formatDate(d.createdAt);
      const downloadName = documentFileName(d.title, d.storageKey);
      const [href, downloadHref] = await Promise.all([
        storage.urlFor(d.storageKey, { expiresInSeconds: 60 * 10 }),
        storage.urlFor(d.storageKey, { expiresInSeconds: 60 * 10, downloadName }),
      ]);
      return {
        key: d.id,
        kind: d.kind as DocumentKind,
        icon: <FileText className="h-4 w-4" />,
        name: d.title,
        href,
        downloadHref,
        downloadName,
        meta: [
          now - d.createdAt.getTime() < NEW_DAYS * 86_400_000 && <NewMark key="neu" />,
          // The kind only where the title does not already say it.
          kindLabel !== d.title && kindLabel,
          valid,
          d.fileSizeBytes != null && (
            <span key="z" className="tabular-nums">
              {formatFileSize(d.fileSizeBytes)}
            </span>
          ),
          d.version > 1 && `Fassung ${d.version}`,
        ],
      };
    })
  );
  const fromRows = [...pinned, ...documentRows];

  // "An EINS gesendet": newest first.
  const sentRows = await Promise.all(
    uploads.map(async (f) => {
      const [url, downloadUrl] = await Promise.all([
        storage.urlFor(f.storageKey, { expiresInSeconds: 60 * 30 }),
        storage.urlFor(f.storageKey, { expiresInSeconds: 60 * 30, downloadName: f.originalFilename }),
      ]);
      return { ...f, url, downloadUrl, preview: previewKind(f.originalFilename) };
    })
  );
  const sentPreviews: PreviewItem[] = sentRows.flatMap((f) =>
    f.preview
      ? [
          {
            id: f.id,
            name: f.originalFilename,
            url: f.url,
            downloadUrl: f.downloadUrl,
            kind: f.preview,
            meta: `${formatFileSize(f.sizeBytes)} · ${formatDate(f.createdAt)}`,
          },
        ]
      : []
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="Dateien" />

      <div className="grid gap-4 md:gap-6 xl:grid-cols-2">
        <FileListState
          param="von"
          rowKinds={fromRows.map((r) => r.kind)}
          initialKind={kind}
          initialPage={pageParam(params.von)}
        >
          <FilesCard
            id="von-eins"
            title="Von EINS"
            count={<FileListCount />}
            action={
              <div className="flex gap-2">
                <DownloadAllFiles />
                {kinds.length > 0 && <KindFilter kinds={kinds} />}
              </div>
            }
            foot={<FileListPager label="Seiten von Von EINS" />}
            // A container, so "Alle herunterladen" shows its words where the
            // card has room for them (DownloadAllFiles).
            className="[container-type:inline-size]"
          >
            <FileListRows
              empty="Noch keine Dateien von EINS."
              emptyFiltered="Zu dieser Art gibt es noch keine Dateien."
            >
              {fromRows.map((r) => (
                <FileRow
                  key={r.key}
                  icon={r.icon}
                  name={r.name}
                  href={r.href}
                  meta={<MetaFacts parts={r.meta} />}
                  action={
                    <Button
                      asChild
                      variant="outline"
                      className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "text-fg-secondary hover:text-fg-primary")}
                    >
                      <a
                        href={r.downloadHref}
                        download={r.downloadName}
                        aria-label={`Herunterladen: ${r.name}`}
                        title="Herunterladen"
                      >
                        <Download className="h-4 w-4" aria-hidden />
                      </a>
                    </Button>
                  }
                />
              ))}
            </FileListRows>
          </FilesCard>
        </FileListState>

        {canSend && (
          <FileListState
            param="an"
            rowKinds={sentRows.map(() => null)}
            rowIds={sentRows.map((f) => f.id)}
            initialPage={pageParam(params.an)}
          >
            <SendArea>
              <FilePreview items={sentPreviews}>
                <FilesCard
                  id="an-eins"
                  title="An EINS gesendet"
                  count={<FileListCount />}
                  action={<SendFilesButton />}
                  foot={
                    <FileListPager
                      label="Seiten von An EINS gesendet"
                      hint={<FootHint>Sie können Dateien auch einfach hierher ziehen.</FootHint>}
                    />
                  }
                  className="[--delay:40ms]"
                >
                  <FileListRows empty="Noch keine Dateien an EINS gesendet.">
                    {sentRows.map((f) => (
                      <FileRow
                        key={f.id}
                        icon={<FileTypeIcon name={f.originalFilename} />}
                        name={f.originalFilename}
                        href={f.url}
                        previewId={f.preview ? f.id : undefined}
                        fresh={now - f.createdAt.getTime() < FRESH_SECONDS * 1000}
                        meta={
                          <MetaFacts
                            parts={[
                              <SeenStatus key="s" seenAt={f.seenAt} />,
                              <span key="z" className="tabular-nums">{formatFileSize(f.sizeBytes)}</span>,
                              <span key="d" className="tabular-nums">{formatDate(f.createdAt)}</span>,
                              f.note && (
                                <NoteSignal key="n" note={f.note} author={f.uploaderName ?? f.uploaderEmail ?? null} />
                              ),
                            ]}
                          />
                        }
                        action={<DeleteFileButton id={f.id} filename={f.originalFilename} />}
                      />
                    ))}
                  </FileListRows>
                </FilesCard>
              </FilePreview>
            </SendArea>
          </FileListState>
        )}
      </div>
    </div>
  );
}

/** Shown in the preview, or null: then the name opens a new tab. */
function previewKind(filename: string): PreviewItem["kind"] | null {
  const ext = fileExtension(filename);
  if (isVideoExtension(ext)) return "video";
  return PREVIEW_IMAGES.includes(ext) ? "image" : null;
}

/** The page a card opens on (`?von=2`); FileListState clamps it. */
function pageParam(param: string | undefined): number {
  const n = Number.parseInt(param ?? "1", 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}
