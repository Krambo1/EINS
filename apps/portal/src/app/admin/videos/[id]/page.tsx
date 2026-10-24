import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, CardContent } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatDateTime } from "@/lib/formatting";
import { formatDuration, obsidianHref } from "@/lib/outreach-video";
import {
  listOutreachVideoSessions,
  listOutreachVideos,
  videoPlaybackUrl,
} from "@/server/outreach-videos";
import { AdminPageHeader } from "../../_components/AdminPageHeader";
import { deleteVideoAction, setVideoArchivedAction } from "../actions";
import { PendingSubmitButton } from "../../_components/PendingSubmitButton";
import { DangerSubmitButton } from "../../_components/DangerSubmitButton";
import { CopyLinkButton } from "../_components/CopyLinkButton";

export const metadata = { title: "Video · Admin" };

const DEVICE_LABEL: Record<string, string> = {
  mobile: "Handy",
  tablet: "Tablet",
  desktop: "Computer",
};

export default async function AdminVideoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const fehler = typeof sp.fehler === "string" ? sp.fehler : null;
  const [video] = await listOutreachVideos({ id, includeArchived: true });
  if (!video) notFound();

  const [sessions, playbackUrl] = await Promise.all([
    listOutreachVideoSessions(video.id),
    videoPlaybackUrl(video.slug),
  ]);
  const archived = Boolean(video.archivedAt);

  return (
    <div className="space-y-8">
      <Link
        href="/admin/videos"
        className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Alle Videos
      </Link>

      <AdminPageHeader
        title={video.praxisName}
        subtitle={video.title ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <form action={setVideoArchivedAction.bind(null, video.id, !archived)}>
              {archived ? (
                <PendingSubmitButton variant="outline" size="sm" pendingLabel="Wird aktiviert …">
                  Wieder aktivieren
                </PendingSubmitButton>
              ) : (
                <DangerSubmitButton
                  size="sm"
                  confirm="Link abschalten? Die Empfängerin sieht danach keine Seite mehr."
                  pendingLabel="Wird archiviert …"
                >
                  Archivieren (Link abschalten)
                </DangerSubmitButton>
              )}
            </form>
            {archived && (
              <form action={deleteVideoAction.bind(null, video.id)}>
                <DangerSubmitButton
                  size="sm"
                  confirm="Video, Auswertung und Datei endgültig löschen? Das lässt sich nicht rückgängig machen."
                  pendingLabel="Wird gelöscht …"
                >
                  Endgültig löschen
                </DangerSubmitButton>
              </form>
            )}
          </div>
        }
      />

      {fehler && (
        <p role="alert" className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] px-4 py-3 text-base text-tone-bad">
          {fehler}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="space-y-4">
            {playbackUrl ? (
              <video
                src={playbackUrl}
                controls
                preload="metadata"
                className="aspect-video w-full rounded-xl bg-black"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-bg-secondary px-3 py-2 text-sm">
                {video.url}
              </code>
              <CopyLinkButton url={video.url} />
            </div>
            {archived && (
              <p className="text-sm text-tone-warn">
                Archiviert: der Link zeigt „nicht gefunden“, bis Sie ihn wieder aktivieren.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 text-base">
            <Stat label="Aufrufe" value={video.opens} />
            <Stat label="Verschiedene Geräte" value={video.viewers} />
            <Stat label="Video gestartet" value={video.plays} />
            <Stat
              label="Durchschnittlich gesehen"
              value={video.avgPercent != null ? `${video.avgPercent} %` : "–"}
            />
            <Stat label="Am weitesten gesehen" value={video.plays > 0 ? `${video.maxPercent} %` : "–"} />
            <Stat label="Klick auf Termin" value={video.ctaClicks} />
            <Stat label="Zuerst geöffnet" value={formatDateTime(video.firstSeenAt)} />
            <Stat label="Zuletzt geöffnet" value={formatDateTime(video.lastSeenAt)} />
            <hr className="border-border" />
            <Stat label="Länge" value={video.durationSeconds ? formatDuration(video.durationSeconds) : "–"} />
            <Stat label="E-Mail" value={video.recipientEmail ?? "–"} />
            <Stat
              label="Obsidian"
              value={
                obsidianHref(video.obsidianRef) ? (
                  <a
                    href={obsidianHref(video.obsidianRef)!}
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    In Obsidian öffnen
                  </a>
                ) : (
                  "–"
                )
              }
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-lg font-semibold">Jeder Aufruf</h2>
          {sessions.length === 0 ? (
            <p className="text-base text-fg-secondary">Noch niemand hat den Link geöffnet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm md:min-w-[640px]">
                <thead className="border-b border-border text-fg-primary">
                  {/* Below md only Geöffnet (with Gerät and "intern" underneath), Gesehen and Termin-Klick. */}
                  <tr>
                    <th className="py-2 pr-2 font-medium md:pr-4">Geöffnet</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Gerät</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Gerät-Kennung</th>
                    <th className="py-2 pr-2 text-right font-medium md:pr-4">Gesehen</th>
                    <th className="py-2 font-medium md:pr-4">Termin-Klick</th>
                    <th className="hidden py-2 font-medium md:table-cell" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.sessionId}
                      className={`border-b border-border last:border-0 ${s.internal ? "text-fg-secondary" : ""}`}
                    >
                      <td className="py-2 pr-2 md:whitespace-nowrap md:pr-4">
                        {formatDateTime(s.firstAt)}
                        <div className="md:hidden">
                          {s.device ? DEVICE_LABEL[s.device] ?? s.device : "Gerät unbekannt"}
                          {s.internal ? ", intern" : ""}
                        </div>
                      </td>
                      <td className="hidden py-2 pr-4 md:table-cell">{s.device ? DEVICE_LABEL[s.device] ?? s.device : "–"}</td>
                      <td className="hidden py-2 pr-4 font-mono text-xs md:table-cell">{s.viewerHash.slice(0, 6)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums md:pr-4">
                        {s.played ? `${s.percent} %` : "nicht gestartet"}
                      </td>
                      <td className="py-2 md:pr-4">{s.cta ? <Badge tone="good">ja</Badge> : "–"}</td>
                      <td className="hidden py-2 md:table-cell">{s.internal ? "intern" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-fg-secondary">
            „Gesehen“ ist die weiteste Marke (10, 25, 50, 75, 90, 100 %). Die Gerät-Kennung wechselt
            jeden Tag und lässt sich nicht auf eine Person oder IP-Adresse zurückführen.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 font-medium text-fg-primary">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}
