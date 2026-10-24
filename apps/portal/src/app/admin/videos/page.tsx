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
  const hinweis = typeof params.hinweis === "string" ? params.hinweis : null;
  const videos = await listOutreachVideos({ includeArchived: showArchived });

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Videos"
        subtitle="Videos für Praxen hochladen, als Link auf eins.ag verschicken und sehen, wer sie anschaut."
      />

      {hinweis && (
        <p role="status" className="rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-4 py-3 text-base text-tone-good">
          {hinweis}
        </p>
      )}

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
            <p className="text-base text-fg-primary">Noch kein Video hochgeladen.</p>
          ) : (
            <div className="overflow-x-auto">
              {/* DS5: below md only Praxis (with last view and links), Aufrufe and Termin-Klick. */}
              <table className="w-full text-left text-sm md:min-w-[860px]">
                <thead className="border-b border-border text-fg-primary">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Praxis</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Hochgeladen</th>
                    <th className="py-2 pr-4 text-right font-medium">Aufrufe</th>
                    <th className="hidden py-2 pr-4 text-right font-medium md:table-cell">Geräte</th>
                    <th className="hidden py-2 pr-4 text-right font-medium md:table-cell">Gestartet</th>
                    <th className="hidden py-2 pr-4 text-right font-medium md:table-cell">Am weitesten</th>
                    <th className="py-2 pr-4 text-right font-medium">Termin-Klick</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Zuletzt angesehen</th>
                    <th className="hidden py-2 font-medium md:table-cell" />
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
          <p className="text-sm text-fg-primary">
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
        <div className="text-sm text-fg-primary">
          {v.title ?? "Ohne Überschrift"}
          {v.durationSeconds ? ` · ${formatDuration(v.durationSeconds)}` : ""}
          {v.archivedAt ? " · archiviert" : ""}
        </div>
        <div className="mt-1 text-sm text-fg-primary md:hidden">
          Zuletzt angesehen: {v.lastSeenAt ? formatRelative(v.lastSeenAt) : "noch nie"}
        </div>
        <div className="mt-2 md:hidden">
          <VideoLinks url={v.url} />
        </div>
      </td>
      <td className="hidden py-3 pr-4 whitespace-nowrap md:table-cell">{formatDate(v.createdAt)}</td>
      <td className="py-3 pr-4 text-right tabular-nums">{v.opens}</td>
      <td className="hidden py-3 pr-4 text-right tabular-nums md:table-cell">{v.viewers}</td>
      <td className="hidden py-3 pr-4 text-right tabular-nums md:table-cell">{v.plays}</td>
      <td className="hidden py-3 pr-4 text-right tabular-nums md:table-cell">
        {v.plays > 0 ? `${v.maxPercent} %` : "–"}
      </td>
      <td className="py-3 pr-4 text-right">
        {v.ctaClicks > 0 ? <Badge tone="good">{v.ctaClicks}</Badge> : <span className="text-fg-primary">0</span>}
      </td>
      <td className="hidden py-3 pr-4 whitespace-nowrap md:table-cell">
        {v.lastSeenAt ? formatRelative(v.lastSeenAt) : "noch nie"}
      </td>
      <td className="hidden py-3 md:table-cell">
        <VideoLinks url={v.url} className="justify-end" />
      </td>
    </tr>
  );
}

function VideoLinks({ url, className = "" }: { url: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <CopyLinkButton url={url} label="Link" />
      <a
        href={`${url}?intern=1`}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline-offset-4 hover:underline"
      >
        Ansehen
      </a>
    </div>
  );
}
