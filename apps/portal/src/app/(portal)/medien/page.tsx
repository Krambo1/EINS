import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Badge,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listAssets } from "@/server/queries/assets";
import { getStorage } from "@/server/storage";
import { formatDate } from "@/lib/formatting";
import { Film, Camera, Package } from "lucide-react";
import type { AssetKind } from "@/lib/constants";

export const metadata = { title: "Medien" };

type Search = { kind?: string };

const KIND_LABELS: Record<AssetKind, string> = {
  video: "Videos",
  foto: "Fotos",
  rohmaterial: "Rohmaterial",
  behind_scenes: "Behind the Scenes",
};

const KIND_ICONS: Record<AssetKind, React.ReactNode> = {
  video: <Film className="h-4 w-4" />,
  foto: <Camera className="h-4 w-4" />,
  rohmaterial: <Package className="h-4 w-4" />,
  behind_scenes: <Camera className="h-4 w-4" />,
};

export default async function MedienPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePermissionOrRedirect("assets.view");
  const params = await searchParams;

  const kind = (
    params.kind && ["video", "foto", "rohmaterial", "behind_scenes"].includes(params.kind)
      ? params.kind
      : undefined
  ) as AssetKind | undefined;

  const assets = await listAssets(session.clinicId, session.userId, { kind });

  // Pre-sign/compute URLs in parallel.
  const storage = getStorage();
  const withUrls = await Promise.all(
    assets.map(async (a) => ({
      ...a,
      url: await storage.urlFor(a.storageKey, { expiresInSeconds: 60 * 30 }),
      posterUrl: a.muxPlaybackId
        ? `https://image.mux.com/${a.muxPlaybackId}/thumbnail.jpg?time=1`
        : null,
    }))
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Medien.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihre Video- und Fotoproduktionen an einem Ort.
        </p>
      </header>

      {/* Kind filter */}
      <nav className="flex flex-wrap gap-2">
        <Link
          href="/medien"
          className={`rounded-full border px-3 py-1.5 text-sm transition ${
            !kind
              ? "border-accent bg-accent/15 text-fg-primary"
              : "border-border text-fg-secondary hover:bg-bg-secondary"
          }`}
        >
          Alle
        </Link>
        {(Object.keys(KIND_LABELS) as AssetKind[]).map((k) => (
          <Link
            key={k}
            href={`/medien?kind=${k}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
              kind === k
                ? "border-accent bg-accent/15 text-fg-primary"
                : "border-border text-fg-secondary hover:bg-bg-secondary"
            }`}
          >
            {KIND_ICONS[k]}
            {KIND_LABELS[k]}
          </Link>
        ))}
      </nav>

      {withUrls.length === 0 ? (
        <EmptyState
          icon={<Film className="h-8 w-8" />}
          title="Noch keine Medien hochgeladen"
          description="Sobald wir Videos oder Fotos für Sie produzieren, erscheinen sie hier."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {withUrls.map((a) => (
            <Card key={a.id} className="overflow-hidden">
              {/* Preview */}
              <div className="relative aspect-video bg-bg-secondary">
                {a.kind === "video" && a.muxPlaybackId ? (
                  <>
                    {a.posterUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.posterUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                    <div className="absolute inset-0 grid place-items-center bg-black/30 text-bg-primary">
                      <Film className="h-12 w-12" />
                    </div>
                  </>
                ) : a.kind === "video" ? (
                  <video
                    src={a.url}
                    className="h-full w-full object-cover"
                    controls
                    preload="metadata"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.url}
                    alt={a.title}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="line-clamp-2 text-lg">
                    {a.title}
                  </CardTitle>
                  <Badge tone="neutral">
                    {KIND_LABELS[a.kind as AssetKind] ?? a.kind}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {a.description && (
                  <p className="line-clamp-3 text-sm text-fg-primary">
                    {a.description}
                  </p>
                )}
                <div className="flex items-center justify-between text-xs text-fg-secondary">
                  <span>
                    {a.shootDate
                      ? `Dreh: ${formatDate(a.shootDate)}`
                      : formatDate(a.createdAt)}
                  </span>
                  {a.version > 1 && <span>v{a.version}</span>}
                </div>
                <div className="flex gap-2">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-md border border-border px-3 py-2 text-center text-sm font-medium hover:bg-bg-secondary"
                  >
                    Ansehen
                  </a>
                  <a
                    href={a.url}
                    download
                    className="flex-1 rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-fg-primary hover:bg-accent/90"
                  >
                    Herunterladen
                  </a>
                </div>
                {a.tags && a.tags.length > 0 && session.uiMode === "detail" && (
                  <div className="flex flex-wrap gap-1">
                    {a.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-bg-secondary px-2 py-0.5 text-xs text-fg-secondary"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {session.uiMode === "detail" && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-3 text-xs">
                    <DtDdItem label="Hochgeladen" value={formatDate(a.createdAt)} />
                    <DtDdItem
                      label="Größe"
                      value={
                        a.fileSizeBytes != null
                          ? formatFileSize(a.fileSizeBytes)
                          : "—"
                      }
                    />
                    <DtDdItem label="MIME" value={a.mimeType ?? "—"} />
                    <DtDdItem
                      label="Version"
                      value={`v${a.version}${a.supersedesId ? " (Update)" : ""}`}
                    />
                    {a.muxPlaybackId && (
                      <DtDdItem label="Mux ID" value={a.muxPlaybackId} />
                    )}
                  </dl>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DtDdItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="text-right tabular-nums text-fg-primary">{value}</dd>
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} GB`;
}
