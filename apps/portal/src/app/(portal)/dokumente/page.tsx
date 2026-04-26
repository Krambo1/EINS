import Link from "next/link";
import {
  Card,
  CardContent,
  EmptyState,
  Badge,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listDocuments } from "@/server/queries/documents";
import { getStorage } from "@/server/storage";
import { formatDate } from "@/lib/formatting";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
  type Role,
} from "@/lib/constants";
import { FileText, Download } from "lucide-react";

export const metadata = { title: "Dokumente" };

type Search = { kind?: string };

const KIND_KEYS = Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[];

export default async function DokumentePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // Any role with "documents.view.marketing" or better can open this page;
  // per-document visibility is filtered below.
  const session = await requirePermissionOrRedirect("documents.view.marketing");
  const params = await searchParams;
  const kind = (
    params.kind && KIND_KEYS.includes(params.kind as DocumentKind)
      ? params.kind
      : undefined
  ) as DocumentKind | undefined;

  const docs = await listDocuments(
    session.clinicId,
    session.userId,
    session.role as Role,
    { kind }
  );

  const storage = getStorage();
  const withUrls = await Promise.all(
    docs.map(async (d) => ({
      ...d,
      url: await storage.urlFor(d.storageKey, { expiresInSeconds: 60 * 10 }),
    }))
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Dokumente.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Verträge, Auswertungen und Leitfäden zum Nachlesen und Herunterladen.
        </p>
      </header>

      {/* Kind filter */}
      <nav className="flex flex-wrap gap-2">
        <Link
          href="/dokumente"
          className={`rounded-full border px-3 py-1.5 text-sm transition ${
            !kind
              ? "border-accent bg-accent/15 text-fg-primary"
              : "border-border text-fg-secondary hover:bg-bg-secondary"
          }`}
        >
          Alle
        </Link>
        {KIND_KEYS.map((k) => (
          <Link
            key={k}
            href={`/dokumente?kind=${k}`}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              kind === k
                ? "border-accent bg-accent/15 text-fg-primary"
                : "border-border text-fg-secondary hover:bg-bg-secondary"
            }`}
          >
            {DOCUMENT_KIND_LABELS[k]}
          </Link>
        ))}
      </nav>

      {withUrls.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="Keine Dokumente vorhanden"
          description="Sobald Verträge, Auswertungen oder Leitfäden bereitstehen, erscheinen sie hier."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {withUrls.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-bg-secondary md:p-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-fg-secondary" />
                      <span className="truncate text-base font-medium text-fg-primary md:text-lg">
                        {d.title}
                      </span>
                      <Badge tone="neutral">
                        {DOCUMENT_KIND_LABELS[d.kind as DocumentKind] ?? d.kind}
                      </Badge>
                      {d.version > 1 && (
                        <span className="text-xs text-fg-secondary">
                          v{d.version}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-fg-secondary">
                      {d.validFrom && (
                        <>Gültig ab {formatDate(d.validFrom)}</>
                      )}
                      {d.validTo && <> bis {formatDate(d.validTo)}</>}
                      {!d.validFrom && !d.validTo && (
                        <>Erstellt am {formatDate(d.createdAt)}</>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-bg-secondary"
                    >
                      Öffnen
                    </a>
                    <a
                      href={d.url}
                      download
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-fg-primary hover:bg-accent/90"
                    >
                      <Download className="h-4 w-4" />
                      Herunterladen
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
