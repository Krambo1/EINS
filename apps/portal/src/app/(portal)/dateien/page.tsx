import { desc, eq } from "drizzle-orm";
import { Badge, Card, CardContent } from "@eins/ui";
import { CheckCheck, Clock } from "lucide-react";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { getStorage } from "@/server/storage";
import { formatDateTime, formatBytes } from "@/lib/formatting";
import { UploadForm } from "./UploadForm";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
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
          <p className="text-base text-fg-secondary">
            Noch keine Dateien gesendet. Alles, was Sie hier hochladen, erscheint in dieser Liste.
          </p>
        ) : (
          <Card>
            <CardContent>
              <ul className="divide-y divide-border">
                {items.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-base font-medium text-fg-primary hover:text-accent"
                      >
                        {f.originalFilename}
                      </a>
                      <div className="mt-1 text-sm text-fg-secondary">
                        {formatBytes(f.sizeBytes)}
                        {" · "}
                        {formatDateTime(f.createdAt)}
                        {f.uploaderName || f.uploaderEmail
                          ? ` · von ${f.uploaderName ?? f.uploaderEmail}`
                          : ""}
                      </div>
                      {f.note && (
                        <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">
                          Notiz: {f.note}
                        </p>
                      )}
                      <div className="mt-2">
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
                      </div>
                    </div>
                    <form
                      action={deleteClientUploadAction}
                      className="shrink-0 border-l border-border pl-4"
                    >
                      <input type="hidden" name="id" value={f.id} />
                      <ConfirmDeleteButton filename={f.originalFilename} />
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
