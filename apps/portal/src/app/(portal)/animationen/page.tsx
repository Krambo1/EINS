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
import { listAnimationsForClinic } from "@/server/queries/assets";
import { getStorage } from "@/server/storage";
import { formatDateTime } from "@/lib/formatting";
import { Clapperboard, Wand2 } from "lucide-react";
import {
  ANIMATION_STATE_LABELS,
  type AnimationState,
} from "@/lib/constants";
import { requestAnimationCustomizationAction } from "./actions";

export const metadata = { title: "Animationen" };

const STATE_TONE: Record<AnimationState, "neutral" | "accent" | "warn" | "good"> = {
  standard: "neutral",
  requested: "warn",
  in_production: "warn",
  ready: "good",
};

export default async function AnimationenPage() {
  const session = await requirePermissionOrRedirect("animations.view");
  const items = await listAnimationsForClinic(session.clinicId, session.userId);

  const storage = getStorage();
  const withUrls = await Promise.all(
    items.map(async ({ library, instance }) => {
      const playKey =
        instance?.storageKeyCustomized ?? library.storageKeyMaster;
      const posterKey = library.previewPosterKey;
      return {
        library,
        instance,
        videoUrl: await storage.urlFor(playKey, { expiresInSeconds: 60 * 30 }),
        posterUrl: posterKey
          ? await storage.urlFor(posterKey, { expiresInSeconds: 60 * 30 })
          : null,
      };
    })
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Animationen.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Erklär-Animationen zu Behandlungen. Standard ist enthalten,
          Anpassungen auf Wunsch.
        </p>
      </header>

      {withUrls.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="h-8 w-8" />}
          title="Noch keine Animationen verfügbar"
          description="Wir bauen die Bibliothek gerade auf. Sobald Animationen bereitstehen, erscheinen sie hier."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {withUrls.map(({ library, instance, videoUrl, posterUrl }) => {
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
                    <Badge tone={STATE_TONE[state]}>
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

                  {session.uiMode === "detail" && (
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
                  )}

                  {/* Request customization */}
                  {(state === "standard" || state === "ready") && (
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
      )}

      {session.uiMode === "detail" && (
        <Card>
          <CardHeader>
            <CardTitle>Was passiert bei einer Anforderung?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-base text-fg-primary">
            <p>
              Wenn Sie eine Anpassung anfordern, erhält das EINS-Team automatisch
              eine Nachricht. Wir melden uns innerhalb von 2 Werktagen mit einem
              Vorschlag und liefern die angepasste Version in der Regel binnen
              einer Woche.
            </p>
            <p>
              Die angepasste Animation ersetzt die Standard-Version automatisch
              auf dieser Seite, sobald sie bereit ist.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
