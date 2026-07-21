import Link from "next/link";
import {
  Card,
  CardContent,
  EmptyState,
  Badge,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { KindFilterSelect } from "./_components/KindFilterSelect";
import {
  listDocuments,
  listVisibleDocumentKinds,
} from "@/server/queries/documents";
import { getStorage } from "@/server/storage";
import { formatDate } from "@/lib/formatting";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
  type Role,
} from "@/lib/constants";
import { FileText, Download, BookOpen, ClipboardCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const metadata = { title: "Dokumente" };

type Search = { kind?: string };

const KIND_KEYS = Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[];

// Produkt-Dokumentation: für jede Praxis gleich. Liegt als statisches Asset
// unter public/ und wird mit jedem Deploy ausgeliefert, also ohne Mandanten-
// Zeile in der DB. Im Standard-Tab ("Alle") oben angepinnt. Beim Filtern auf
// eine Dokumentenart ausgeblendet.
const PINNED_DOCS: ReadonlyArray<{
  key: string;
  icon: LucideIcon;
  badge: string;
  title: string;
  description: string;
  href: string;
  downloadName: string;
}> = [
  {
    key: "anleitung",
    icon: BookOpen,
    badge: "Anleitung",
    title: "EINS Portal: Die komplette Anleitung",
    description:
      "Schritt für Schritt: So nutzen Sie alle Funktionen Ihres Portals. Zum Nachlesen und Herunterladen.",
    href: "/anleitung/eins-portal-anleitung.pdf",
    downloadName: "EINS Portal - Die komplette Anleitung.pdf",
  },
  {
    key: "checkliste",
    icon: ClipboardCheck,
    badge: "Checkliste",
    title: "Asset-Liefer-Checkliste: Alles für den Start",
    description:
      "Alle Zugänge, Dateien und Angaben für Ihr Onboarding, mit Anleitung pro Punkt. Liefern können Sie alles direkt im Portal unter Erste Schritte.",
    href: "/anleitung/eins-asset-checkliste.pdf",
    downloadName: "EINS Asset-Liefer-Checkliste.pdf",
  },
];

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

  const [docs, availableKinds] = await Promise.all([
    listDocuments(session.clinicId, session.userId, session.role as Role, {
      kind,
    }),
    // Only offer filter chips for kinds this role can actually see documents
    // in. Verträge/AVV are inhaber-only, so a marketing/frontdesk user must not
    // get a "Vertrag" chip that would just render an empty list.
    listVisibleDocumentKinds(
      session.clinicId,
      session.userId,
      session.role as Role
    ),
  ]);

  const storage = getStorage();
  const withUrls = await Promise.all(
    docs.map(async (d) => ({
      ...d,
      url: await storage.urlFor(d.storageKey, { expiresInSeconds: 60 * 10 }),
    }))
  );

  // Die angepinnten Produkt-Dokumente (Anleitung, Checkliste) sind keine
  // Verträge: oben im Standard-Tab ("Alle") anpinnen, beim Filtern auf eine
  // Dokumentenart ausblenden.
  const showPinned = !kind;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Dokumente.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Verträge, Auswertungen und Leitfäden zum Nachlesen und Herunterladen.
        </p>
      </header>

      {/* Kind filter — dropdown on mobile, pill row on sm+. Only kinds the role
          can actually see documents in are offered; hidden entirely when there
          is nothing to filter. */}
      {availableKinds.length > 0 && (
        <>
      <div className="sm:hidden">
        <KindFilterSelect kind={kind} availableKinds={availableKinds} />
      </div>
      <nav className="hidden flex-wrap gap-2 sm:flex">
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
        {availableKinds.map((k) => (
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
        </>
      )}

      {withUrls.length === 0 && !showPinned ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="Keine Dokumente vorhanden"
          description="Sobald Verträge, Auswertungen oder Leitfäden bereitstehen, erscheinen sie hier."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {showPinned &&
                PINNED_DOCS.map((d) => {
                  const Icon = d.icon;
                  return (
                    <li
                      key={d.key}
                      className="flex flex-col gap-3 p-4 transition hover:bg-bg-secondary sm:flex-row sm:flex-wrap sm:items-center sm:justify-between md:p-5"
                    >
                      <div className="min-w-0 sm:flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Icon className="h-4 w-4 shrink-0 text-accent" />
                          <span className="min-w-0 break-words text-base font-medium text-fg-primary md:text-lg">
                            {d.title}
                          </span>
                          <Badge tone="neutral" className="shrink-0">
                            {d.badge}
                          </Badge>
                        </div>
                        <div className="mt-1 text-sm text-fg-secondary">
                          {d.description}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <a
                          href={d.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 rounded-md border border-border px-3 py-2 text-center text-sm font-medium hover:bg-bg-secondary sm:flex-none"
                        >
                          Öffnen
                        </a>
                        <a
                          href={d.href}
                          download={d.downloadName}
                          className="opa-btn-primary opa-focus-ring inline-flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium sm:flex-none"
                        >
                          <Download className="h-4 w-4" />
                          Herunterladen
                        </a>
                      </div>
                    </li>
                  );
                })}
              {withUrls.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-3 p-4 transition hover:bg-bg-secondary sm:flex-row sm:flex-wrap sm:items-center sm:justify-between md:p-5"
                >
                  <div className="min-w-0 sm:flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <FileText className="h-4 w-4 shrink-0 text-fg-secondary" />
                      <span className="min-w-0 break-words text-base font-medium text-fg-primary md:text-lg">
                        {d.title}
                      </span>
                      <Badge tone="neutral" className="shrink-0">
                        {DOCUMENT_KIND_LABELS[d.kind as DocumentKind] ?? d.kind}
                      </Badge>
                      {d.version > 1 && (
                        <span className="shrink-0 text-xs text-fg-secondary">
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
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded-md border border-border px-3 py-2 text-center text-sm font-medium hover:bg-bg-secondary sm:flex-none"
                    >
                      Öffnen
                    </a>
                    <a
                      href={d.url}
                      download
                      className="opa-btn-primary opa-focus-ring inline-flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium sm:flex-none"
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
