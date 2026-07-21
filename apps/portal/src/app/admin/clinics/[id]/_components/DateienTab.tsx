import { Badge, Button, Card, CardContent, EmptyState } from "@eins/ui";
import { CheckCheck, Download, FileUp, Undo2 } from "lucide-react";
import {
  markAllClientUploadsSeenAction,
  setClientUploadSeenAction,
} from "../actions";

const GLOW_CARD = "!bg-bg-secondary";

export interface DateienTabUpload {
  id: string;
  name: string;
  sizeBytes: number;
  url: string;
  note: string | null;
  createdAt: Date;
  seenAt: Date | null;
  seenBy: string | null;
  uploaderName: string | null;
}

export interface DateienTabData {
  clinicId: string;
  uploads: DateienTabUpload[];
}

/**
 * Admin view of "Dateien an EINS": every file the Praxis delivered through
 * the portal, newest first, with download links and the seen/unseen read
 * receipt that drives the clinic-side "Von EINS gesehen" badge.
 */
export function DateienTab({ data }: { data: DateienTabData }) {
  const { clinicId, uploads } = data;
  const unseen = uploads.filter((u) => u.seenAt === null).length;

  if (uploads.length === 0) {
    return (
      <EmptyState
        icon={<FileUp className="h-8 w-8" />}
        title="Noch keine Dateien"
        description="Die Praxis hat noch nichts über „Dateien an EINS“ hochgeladen."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card className={GLOW_CARD}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="text-xs text-fg-secondary">Neu (ungesehen)</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {unseen} / {uploads.length}
            </div>
          </div>
          {unseen > 0 && (
            <form action={markAllClientUploadsSeenAction}>
              <input type="hidden" name="clinicId" value={clinicId} />
              <Button type="submit" variant="outline" size="sm">
                <CheckCheck className="h-4 w-4" />
                Alle als gesehen markieren
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardContent>
          <ul className="divide-y divide-border">
            {uploads.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={u.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-fg-primary hover:text-accent"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    <span className="truncate">{u.name}</span>
                  </a>
                  <div className="mt-0.5 text-xs text-fg-secondary">
                    {formatBytes(u.sizeBytes)}
                    {" · "}
                    {formatDateTime(u.createdAt)}
                    {u.uploaderName ? ` · von ${u.uploaderName}` : ""}
                  </div>
                  {u.note && (
                    <p className="mt-1 text-xs text-fg-tertiary">
                      Notiz: {u.note}
                    </p>
                  )}
                </div>
                {u.seenAt ? (
                  <>
                    <Badge tone="good">Gesehen</Badge>
                    <form action={setClientUploadSeenAction}>
                      <input type="hidden" name="clinicId" value={clinicId} />
                      <input type="hidden" name="uploadId" value={u.id} />
                      <input type="hidden" name="seen" value="0" />
                      <button
                        type="submit"
                        className="text-fg-tertiary hover:text-fg-primary"
                        aria-label="Als ungesehen markieren"
                        title="Als ungesehen markieren"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <Badge tone="warn">Neu</Badge>
                    <form action={setClientUploadSeenAction}>
                      <input type="hidden" name="clinicId" value={clinicId} />
                      <input type="hidden" name="uploadId" value={u.id} />
                      <input type="hidden" name="seen" value="1" />
                      <Button type="submit" variant="outline" size="sm">
                        <CheckCheck className="h-4 w-4" />
                        Gesehen
                      </Button>
                    </form>
                  </>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
