import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatDateTime } from "@/lib/formatting";
import { formatDuration } from "@/lib/outreach-video";
import {
  listOutreachVideoSessions,
  listOutreachVideos,
  videoPlaybackUrl,
} from "@/server/outreach-videos";
import { AdminPageHeader } from "../../_components/AdminPageHeader";
import { setVideoArchivedAction } from "../actions";
import { CopyLinkButton } from "../_components/CopyLinkButton";

export const metadata = { title: "Video · Admin" };

const DEVICE_LABEL: Record<string, string> = {
  mobile: "Handy",
  tablet: "Tablet",
  desktop: "Computer",
};

export default async function AdminVideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
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
          <form action={setVideoArchivedAction.bind(null, video.id, !archived)}>
            <Button type="submit" variant="outline" size="sm">
              {archived ? "Wieder aktivieren" : "Archivieren (Link abschalten)"}
            </Button>
          </form>
        }
      />

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
              label="Notion"
              value={
                video.notionPageId ? (
                  <a
                    href={`https://www.notion.so/${video.notionPageId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    Lead öffnen
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
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border text-fg-secondary">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Geöffnet</th>
                    <th className="py-2 pr-4 font-medium">Gerät</th>
                    <th className="py-2 pr-4 font-medium">Gerät-Kennung</th>
                    <th className="py-2 pr-4 text-right font-medium">Gesehen</th>
                    <th className="py-2 pr-4 font-medium">Termin-Klick</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.sessionId}
                      className={`border-b border-border last:border-0 ${s.internal ? "text-fg-tertiary" : ""}`}
                    >
                      <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(s.firstAt)}</td>
                      <td className="py-2 pr-4">{s.device ? DEVICE_LABEL[s.device] ?? s.device : "–"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{s.viewerHash.slice(0, 6)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {s.played ? `${s.percent} %` : "nicht gestartet"}
                      </td>
                      <td className="py-2 pr-4">{s.cta ? <Badge tone="good">ja</Badge> : "–"}</td>
                      <td className="py-2">{s.internal ? "intern" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-fg-tertiary">
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
      <span className="text-fg-secondary">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}
