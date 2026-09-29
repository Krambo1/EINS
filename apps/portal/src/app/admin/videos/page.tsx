import Link from "next/link";
import { Badge, Card, CardContent } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatDate, formatRelative } from "@/lib/formatting";
import { formatDuration } from "@/lib/outreach-video";
import { listOutreachVideos, type OutreachVideoStats } from "@/server/outreach-videos";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { CopyLinkButton } from "./_components/CopyLinkButton";
import { VideoUploadCard } from "./_components/VideoUploadCard";

export const metadata = { title: "Videos · Admin" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminVideosPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const showArchived = params.archiviert === "1";
  const videos = await listOutreachVideos({ includeArchived: showArchived });

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Videos"
        subtitle="Videos für Praxen hochladen, als Link auf eins.ag verschicken und sehen, wer sie anschaut."
      />

      <VideoUploadCard />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Alle Videos</h2>
            <Link
              href={showArchived ? "/admin/videos" : "/admin/videos?archiviert=1"}
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              {showArchived ? "Nur aktive zeigen" : "Archivierte mit anzeigen"}
            </Link>
          </div>

          {videos.length === 0 ? (
            <p className="text-base text-fg-secondary">Noch kein Video hochgeladen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-border text-fg-secondary">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Praxis</th>
                    <th className="py-2 pr-4 font-medium">Hochgeladen</th>
                    <th className="py-2 pr-4 text-right font-medium">Aufrufe</th>
                    <th className="py-2 pr-4 text-right font-medium">Geräte</th>
                    <th className="py-2 pr-4 text-right font-medium">Gestartet</th>
                    <th className="py-2 pr-4 text-right font-medium">Am weitesten</th>
                    <th className="py-2 pr-4 text-right font-medium">Termin-Klick</th>
                    <th className="py-2 pr-4 font-medium">Zuletzt angesehen</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <VideoRow key={v.id} v={v} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-fg-tertiary">
            Eigene Aufrufe über „Ansehen“ (mit ?intern=1) zählen nicht mit. „Geräte“ zählt
            verschiedene Geräte pro Tag, ohne Cookie.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function VideoRow({ v }: { v: OutreachVideoStats }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pr-4">
        <Link href={`/admin/videos/${v.id}`} className="font-medium hover:underline">
          {v.praxisName}
        </Link>
        <div className="text-xs text-fg-tertiary">
          {v.title ?? "Ohne Überschrift"}
          {v.durationSeconds ? ` · ${formatDuration(v.durationSeconds)}` : ""}
          {v.archivedAt ? " · archiviert" : ""}
        </div>
      </td>
      <td className="py-3 pr-4 whitespace-nowrap">{formatDate(v.createdAt)}</td>
      <td className="py-3 pr-4 text-right tabular-nums">{v.opens}</td>
      <td className="py-3 pr-4 text-right tabular-nums">{v.viewers}</td>
      <td className="py-3 pr-4 text-right tabular-nums">{v.plays}</td>
      <td className="py-3 pr-4 text-right tabular-nums">
        {v.plays > 0 ? `${v.maxPercent} %` : "–"}
      </td>
      <td className="py-3 pr-4 text-right">
        {v.ctaClicks > 0 ? <Badge tone="good">{v.ctaClicks}</Badge> : <span className="text-fg-tertiary">0</span>}
      </td>
      <td className="py-3 pr-4 whitespace-nowrap">
        {v.lastSeenAt ? formatRelative(v.lastSeenAt) : <span className="text-fg-tertiary">noch nie</span>}
      </td>
      <td className="py-3">
        <div className="flex items-center justify-end gap-3">
          <CopyLinkButton url={v.url} label="Link" />
          <a
            href={`${v.url}?intern=1`}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            Ansehen
          </a>
        </div>
      </td>
    </tr>
  );
}
