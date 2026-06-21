import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Badge,
  Button,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listAssets, listAnimationsForClinic } from "@/server/queries/assets";
import { getStorage } from "@/server/storage";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { Film, Camera, Package, Clapperboard, Wand2 } from "lucide-react";
import {
  ANIMATION_STATE_LABELS,
  type AnimationState,
  type AssetKind,
} from "@/lib/constants";
import { can } from "@/lib/roles";
import { requestAnimationCustomizationAction } from "./actions";

export const metadata = { title: "Medien" };

type Filter = AssetKind | "animationen";
type Search = { kind?: string };

const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  video: "Videos",
  foto: "Fotos",
  rohmaterial: "Rohmaterial",
  behind_scenes: "Behind the Scenes",
};

const ASSET_KIND_ICONS: Record<AssetKind, React.ReactNode> = {
  video: <Film className="h-4 w-4" />,
  foto: <Camera className="h-4 w-4" />,
  rohmaterial: <Package className="h-4 w-4" />,
  behind_scenes: <Camera className="h-4 w-4" />,
};

const ANIMATION_STATE_TONE: Record<
  AnimationState,
  "neutral" | "accent" | "warn" | "good"
> = {
  standard: "neutral",
  requested: "warn",
  in_production: "warn",
  ready: "good",
};

const ASSET_KINDS: AssetKind[] = ["video", "foto", "rohmaterial", "behind_scenes"];

function parseFilter(raw: string | undefined): Filter | undefined {
  if (!raw) return undefined;
  if (raw === "animationen") return "animationen";
  if ((ASSET_KINDS as string[]).includes(raw)) return raw as AssetKind;
  return undefined;
}

export default async function MedienPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePermissionOrRedirect("assets.view");
  const params = await searchParams;
  const filter = parseFilter(params.kind);

  const showAnimations =
    can(session.role, "animations.view") &&
    (filter === undefined || filter === "animationen");
  const showAssets = filter !== "animationen";

  const assetKindFilter: AssetKind | undefined =
    filter && filter !== "animationen" ? filter : undefined;

  const [assets, animations] = await Promise.all([
    showAssets
      ? listAssets(session.clinicId, session.userId, { kind: assetKindFilter })
      : Promise.resolve([]),
    showAnimations
      ? listAnimationsForClinic(session.clinicId, session.userId)
      : Promise.resolve([]),
  ]);

  const storage = getStorage();
  const [assetCards, animationCards] = await Promise.all([
    Promise.all(
      assets.map(async (a) => ({
        ...a,
        url: await storage.urlFor(a.storageKey, { expiresInSeconds: 60 * 30 }),
        posterUrl: a.muxPlaybackId
          ? `https://image.mux.com/${a.muxPlaybackId}/thumbnail.jpg?time=1`
          : null,
      }))
    ),
    Promise.all(
      animations.map(async ({ library, instance }) => {
        const playKey =
          instance?.storageKeyCustomized ?? library.storageKeyMaster;
        const posterKey = library.previewPosterKey;
        return {
          library,
          instance,
          videoUrl: await storage.urlFor(playKey, {
            expiresInSeconds: 60 * 30,
          }),
          posterUrl: posterKey
            ? await storage.urlFor(posterKey, { expiresInSeconds: 60 * 30 })
            : null,
        };
      })
    ),
  ]);

  const showSectionHeaders =
    filter === undefined &&
    showAnimations &&
    assetCards.length > 0 &&
    animationCards.length > 0;

  const empty = assetCards.length === 0 && animationCards.length === 0;

  return (
    <div className="space-y-8">
      <header data-tour="medien-header">
        <h1 className="text-3xl font-semibold md:text-4xl">Medien.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihre Video- und Fotoproduktionen sowie Erklär-Animationen an einem
          Ort.
        </p>
      </header>

      {/* Filter chips */}
      <nav className="flex flex-wrap gap-2">
        <FilterChip href="/medien" active={filter === undefined}>
          Alle
        </FilterChip>
        {ASSET_KINDS.map((k) => (
          <FilterChip
            key={k}
            href={`/medien?kind=${k}`}
            active={filter === k}
            icon={ASSET_KIND_ICONS[k]}
          >
            {ASSET_KIND_LABELS[k]}
          </FilterChip>
        ))}
        {can(session.role, "animations.view") && (
          <FilterChip
            href="/medien?kind=animationen"
            active={filter === "animationen"}
            icon={<Clapperboard className="h-4 w-4" />}
          >
            Animationen
          </FilterChip>
        )}
      </nav>

      {empty && (
        <EmptyState
          icon={<Film className="h-8 w-8" />}
          title={
            filter === "animationen"
              ? "Noch keine Animationen verfügbar"
              : "Noch keine Medien hochgeladen"
          }
          description={
            filter === "animationen"
              ? "Wir bauen die Bibliothek gerade auf. Sobald Animationen bereitstehen, erscheinen sie hier."
              : "Sobald wir Videos oder Fotos für Sie produzieren, erscheinen sie hier."
          }
        />
      )}

      {showAssets && assetCards.length > 0 && (
        <section className="space-y-4">
          {showSectionHeaders && (
            <h2 className="text-xl font-semibold">Aufnahmen</h2>
          )}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {assetCards.map((a) => (
              <Card key={a.id} className="overflow-hidden">
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
                      {ASSET_KIND_LABELS[a.kind as AssetKind] ?? a.kind}
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
                      className="opa-btn-primary opa-focus-ring flex-1 rounded-md px-3 py-2 text-center text-sm font-medium"
                    >
                      Herunterladen
                    </a>
                  </div>
                  {a.tags && a.tags.length > 0 && (
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

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-3 text-xs">
                      <DtDdItem
                        label="Hochgeladen"
                        value={formatDate(a.createdAt)}
                      />
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
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {showAnimations && animationCards.length > 0 && (
        <section className="space-y-4">
          {showSectionHeaders && (
            <h2 className="text-xl font-semibold">Animationen</h2>
          )}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {animationCards.map(({ library, instance, videoUrl, posterUrl }) => {
              const state = (instance?.status ?? "standard") as AnimationState;
              return (
                <Card key={library.id} className="overflow-hidden">
                  <div className="relative aspect-video bg-bg-secondary">
                    <video
                      src={videoUrl}
                      poster={posterUrl ?? undefined}
                      className="h-full w-full object-cover"
                      controls
                      preload="metadata"
                    />
                  </div>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-2 text-lg">
                        {library.title}
                      </CardTitle>
                      <Badge tone={ANIMATION_STATE_TONE[state]}>
                        {ANIMATION_STATE_LABELS[state]}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {library.treatmentTag && (
                      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                        {library.treatmentTag}
                      </div>
                    )}
                    {library.description && (
                      <p className="line-clamp-3 text-sm text-fg-primary">
                        {library.description}
                      </p>
                    )}
                    {state === "requested" && instance?.requestedAt && (
                      <p className="text-sm text-fg-secondary">
                        Angefordert am {formatDateTime(instance.requestedAt)}.
                        Wir melden uns sobald die Anpassung fertig ist.
                      </p>
                    )}
                    {state === "ready" && instance?.deliveredAt && (
                      <p className="text-sm text-tone-good">
                        Angepasste Version bereit seit{" "}
                        {formatDateTime(instance.deliveredAt)}.
                      </p>
                    )}

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-3 text-xs">
                        <dt className="text-fg-secondary">Status</dt>
                        <dd className="text-right font-medium text-fg-primary">
                          {ANIMATION_STATE_LABELS[state]}
                        </dd>
                        <dt className="text-fg-secondary">Angefordert</dt>
                        <dd className="text-right tabular-nums text-fg-primary">
                          {instance?.requestedAt
                            ? formatDateTime(instance.requestedAt)
                            : "—"}
                        </dd>
                        <dt className="text-fg-secondary">Geliefert</dt>
                        <dd className="text-right tabular-nums text-fg-primary">
                          {instance?.deliveredAt
                            ? formatDateTime(instance.deliveredAt)
                            : "—"}
                        </dd>
                        <dt className="text-fg-secondary">Dauer</dt>
                        <dd className="text-right tabular-nums text-fg-primary">
                          {library.durationS ? `${library.durationS}s` : "—"}
                        </dd>
                        {instance?.requestNote && (
                          <>
                            <dt className="col-span-2 text-fg-secondary">
                              Notiz zur Anpassung
                            </dt>
                            <dd className="col-span-2 text-fg-primary">
                              {instance.requestNote}
                            </dd>
                          </>
                        )}
                      </dl>

                    {(state === "standard" || state === "ready") &&
                      can(session.role, "animations.request_customization") && (
                        <form
                          action={requestAnimationCustomizationAction}
                          className="space-y-2 border-t border-border pt-3"
                        >
                          <input
                            type="hidden"
                            name="libraryId"
                            value={library.id}
                          />
                          <label className="block text-xs font-medium text-fg-secondary">
                            Anpassung anfordern (optional)
                          </label>
                          <textarea
                            name="note"
                            rows={2}
                            placeholder="Was möchten Sie ändern? Logo, Farbe, Stimme …"
                            className="w-full rounded-lg border border-border bg-bg-primary p-2 text-sm"
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            className="w-full"
                          >
                            <Wand2 className="h-4 w-4" />
                            {state === "ready"
                              ? "Weitere Anpassung anfordern"
                              : "Anpassung anfordern"}
                          </Button>
                        </form>
                      )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filter === "animationen" && (
            <Card>
              <CardHeader>
                <CardTitle>Was passiert bei einer Anforderung?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-base text-fg-primary">
                <p>
                  Wenn Sie eine Anpassung anfordern, erhält das EINS-Team
                  automatisch eine Nachricht. Wir melden uns innerhalb von 2
                  Werktagen mit einem Vorschlag und liefern die angepasste
                  Version in der Regel binnen einer Woche.
                </p>
                <p>
                  Die angepasste Animation ersetzt die Standard-Version
                  automatisch auf dieser Seite, sobald sie bereit ist.
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "border-accent bg-accent/15 text-fg-primary"
          : "border-border text-fg-secondary hover:bg-bg-secondary"
      }`}
    >
      {icon}
      {children}
    </Link>
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
