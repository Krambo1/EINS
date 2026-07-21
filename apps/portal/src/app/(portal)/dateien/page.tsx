import { desc, eq } from "drizzle-orm";
import { Badge, Card, CardContent, EmptyState } from "@eins/ui";
import { CheckCheck, Clock, FileUp, Trash2 } from "lucide-react";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { getStorage } from "@/server/storage";
import { formatDateTime } from "@/lib/formatting";
import { UploadForm } from "./UploadForm";
import { deleteClientUploadAction } from "./actions";

export const metadata = { title: "Dateien an EINS" };

export default async function DateienPage() {
  const session = await requirePermissionOrRedirect("uploads.send");

  const rows = await withClinicContext(
    session.clinicId,
    session.userId,
    async (tx) =>
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
        .leftJoin(
          schema.clinicUsers,
          eq(schema.clientUploads.uploadedBy, schema.clinicUsers.id)
        )
        .where(eq(schema.clientUploads.clinicId, session.clinicId))
        .orderBy(desc(schema.clientUploads.createdAt))
  );

  const storage = getStorage();
  const items = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      url: await storage.urlFor(r.storageKey, { expiresInSeconds: 60 * 30 }),
    }))
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Dateien an EINS.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Senden Sie uns Dokumente, Bilder und Videos direkt über das Portal.
          Kein E-Mail-Anhang, keine Größenprobleme.
        </p>
      </header>

      <UploadForm />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Bereits gesendet</h2>
        {items.length === 0 ? (
          <EmptyState
            icon={<FileUp className="h-8 w-8" />}
            title="Noch keine Dateien gesendet"
            description="Alles, was Sie hier hochladen, erscheint in dieser Liste und beim EINS-Team."
          />
        ) : (
          <Card>
            <CardContent>
              <ul className="divide-y divide-border">
                {items.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-sm font-medium text-fg-primary hover:text-accent"
                      >
                        {f.originalFilename}
                      </a>
                      <div className="mt-0.5 text-xs text-fg-secondary">
                        {formatBytes(f.sizeBytes)}
                        {" · "}
                        {formatDateTime(f.createdAt)}
                        {f.uploaderName || f.uploaderEmail
                          ? ` · von ${f.uploaderName ?? f.uploaderEmail}`
                          : ""}
                      </div>
                      {f.note && (
                        <p className="mt-1 line-clamp-2 text-xs text-fg-tertiary">
                          Notiz: {f.note}
                        </p>
                      )}
                    </div>
                    {f.seenAt ? (
                      <Badge tone="good">
                        <CheckCheck className="mr-1 h-3.5 w-3.5" />
                        Von EINS gesehen
                      </Badge>
                    ) : (
                      <Badge tone="accent">
                        <Clock className="mr-1 h-3.5 w-3.5" />
                        Übermittelt
                      </Badge>
                    )}
                    <form action={deleteClientUploadAction}>
                      <input type="hidden" name="id" value={f.id} />
                      <button
                        type="submit"
                        className="text-fg-tertiary hover:text-tone-bad"
                        aria-label={`${f.originalFilename} löschen`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
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
