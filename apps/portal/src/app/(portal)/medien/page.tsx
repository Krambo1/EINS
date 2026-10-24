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
import { listAssets, listAnimationsForClinic } from "@/server/queries/assets";
import { getStorage } from "@/server/storage";
import { formatDate } from "@/lib/formatting";
import { Film, Camera, Package, Clapperboard } from "lucide-react";
import {
  ANIMATION_STATE_LABELS,
  type AnimationState,
  type AssetKind,
} from "@/lib/constants";
import { can } from "@/lib/roles";
import { RequestCustomizationForm } from "./RequestCustomizationForm";

/** Assets per page; "Alle anzeigen" lifts the cap. */
const ASSET_PAGE_SIZE = 60;

export const metadata = { title: "Medien" };

type Filter = AssetKind | "animationen";
type Search = { kind?: string; alle?: string };

// Die Datenbank erlaubt weiterhin vier Arten (CHECK-Constraint). Neue Beiträge
// sind Videos oder Bildmaterial, die beiden anderen Arten heißen neutral.
const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  video: "Videos",
  foto: "Bildmaterial",
  rohmaterial: "Weiteres Material",
  behind_scenes: "Weiteres Material",
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
// Filter-Chips: nur die Arten, die neue Beiträge haben. Ältere Links auf die
// anderen Arten funktionieren weiter (parseFilter).
const FILTER_KINDS: AssetKind[] = ["video", "foto"];

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

  const showAllAssets = params.alle === "1";
  const [assetRows, animations] = await Promise.all([
    showAssets
      ? listAssets(session.clinicId, session.userId, {
          kind: assetKindFilter,
          limit: showAllAssets ? undefined : ASSET_PAGE_SIZE + 1,
        })
      : Promise.resolve([]),
    showAnimations
      ? listAnimationsForClinic(session.clinicId, session.userId)
      : Promise.resolve([]),
  ]);

  const hasMoreAssets = !showAllAssets && assetRows.length > ASSET_PAGE_SIZE;
  const assets = hasMoreAssets ? assetRows.slice(0, ASSET_PAGE_SIZE) : assetRows;

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
          Alle Videos, Animationen und Bilder für Ihre Praxis. Online geht nur, was Sie unter{" "}
          <Link href="/beitraege" className="font-medium underline underline-offset-4">
            Beiträge
          </Link>{" "}
          freigeben.
        </p>
        <p className="mt-2 text-sm text-fg-secondary">
          Das Material gehört Ihnen: Sobald die erste Rechnung bezahlt ist,
          dürfen Sie alles, was für Ihre Praxis entstanden ist, dauerhaft
          nutzen und bearbeiten, auch nach einer Kündigung und mit einer anderen
          Agentur.
        </p>
      </header>

      {/* Filter chips */}
      <nav className="flex flex-wrap gap-2">
        <FilterChip href="/medien" active={filter === undefined}>
          Alle
        </FilterChip>
        {FILTER_KINDS.map((k) => (
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
              : "Noch keine Beiträge vorhanden"
          }
          description={
            filter === "animationen"
              ? "Wir bauen die Bibliothek gerade auf. Sobald Animationen bereitstehen, erscheinen sie hier."
              : "Sobald Ihre ersten Beiträge fertig sind, erscheinen sie hier. Veröffentlicht wird erst nach Ihrer Freigabe."
          }
        />
      )}

      {showAssets && assetCards.length > 0 && (
        <section className="space-y-4">
          {showSectionHeaders && (
            <h2 className="text-xl font-semibold">Videos und Bildmaterial</h2>
          )}
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {assetCards.map((a) => (
              <Card key={a.id} className="flex flex-col overflow-hidden !p-0 md:!p-0">
                <div className="relative aspect-video bg-bg-secondary">
                  {a.kind === "video" && a.muxPlaybackId ? (
                    <>
                      {a.posterUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.posterUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
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
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div>
                    <h3 className="line-clamp-2 break-words text-lg font-semibold leading-snug">
                      {a.title}
                    </h3>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {[
                        ASSET_KIND_LABELS[a.kind as AssetKind] ?? a.kind,
                        formatDate(a.createdAt),
                        a.fileSizeBytes != null ? formatFileSize(a.fileSizeBytes) : null,
                        a.supersedesId ? `Fassung ${a.version}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {a.description && (
                    <p className="line-clamp-2 text-sm text-fg-primary">{a.description}</p>
                  )}
                  {a.tags && a.tags.length > 0 && (
                    <p className="text-sm text-fg-secondary">
                      {a.tags.map((t) => `#${t}`).join(" ")}
                    </p>
                  )}
                  <div className="mt-auto flex gap-2 pt-2">
                    <a
                      href={a.url}
                      download
                      className="opa-btn-primary opa-focus-ring flex-1 rounded-md px-3 py-2 text-center text-sm font-medium"
                    >
                      Herunterladen
                    </a>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded-md border border-border px-3 py-2 text-center text-sm font-medium hover:bg-bg-secondary"
                    >
                      Ansehen
                    </a>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {hasMoreAssets && (
            <div className="flex justify-center">
              <Link
                href={`/medien?${new URLSearchParams({
                  ...(filter ? { kind: filter } : {}),
                  alle: "1",
                }).toString()}`}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-bg-secondary"
              >
                Ältere Beiträge anzeigen
              </Link>
            </div>
          )}
        </section>
      )}

      {showAnimations && animationCards.length > 0 && (
        <section className="space-y-4">
          {showSectionHeaders && (
            <h2 className="text-xl font-semibold">Animationen</h2>
          )}
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {animationCards.map(({ library, instance, videoUrl, posterUrl }) => {
              const state = (instance?.status ?? "standard") as AnimationState;
              const canRequest =
                (state === "standard" || state === "ready") &&
                can(session.role, "animations.request_customization");
              return (
                <Card key={library.id} className="flex flex-col overflow-hidden !p-0 md:!p-0">
                  <div className="relative aspect-video bg-black">
                    <video
                      src={videoUrl}
                      poster={posterUrl ?? undefined}
                      className="h-full w-full object-cover"
                      controls
                      preload="metadata"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div>
                      <h3 className="line-clamp-2 break-words text-lg font-semibold leading-snug">
                        {library.title}
                      </h3>
                      <p className="mt-1 text-sm text-fg-secondary">
                        {["Animation", library.durationS ? `${library.durationS} Sekunden` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {library.description && (
                      <p className="line-clamp-2 text-sm text-fg-primary">{library.description}</p>
                    )}
                    {state !== "standard" && (
                      <div className="space-y-1">
                        <Badge tone={ANIMATION_STATE_TONE[state]}>
                          {state === "ready" && instance?.deliveredAt
                            ? `Angepasst am ${formatDate(instance.deliveredAt)}`
                            : state === "requested" && instance?.requestedAt
                              ? `Angefragt am ${formatDate(instance.requestedAt)}`
                              : ANIMATION_STATE_LABELS[state]}
                        </Badge>
                        {(state === "requested" || state === "in_production") && (
                          <p className="text-sm text-fg-secondary">
                            Wir melden uns, sobald die Anpassung fertig ist.
                          </p>
                        )}
                        {instance?.requestNote && (
                          <p className="text-sm text-fg-primary">
                            Ihr Wunsch: „{instance.requestNote}“
                          </p>
                        )}
                      </div>
                    )}
                    {canRequest && (
                      <details className="mt-auto pt-2">
                        <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-bg-secondary [&::-webkit-details-marker]:hidden">
                          {state === "ready" ? "Weitere Anpassung anfordern" : "Anpassung anfordern"}
                        </summary>
                        <RequestCustomizationForm libraryId={library.id} label="Anfrage senden" />
                      </details>
                    )}
                  </div>
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
          ? "border-fg-primary bg-fg-primary font-medium text-bg-primary"
          : "border-border bg-bg-primary text-fg-secondary hover:bg-bg-secondary"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} GB`;
}
