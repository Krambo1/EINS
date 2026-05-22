import Link from "next/link";
import { requireSession } from "@/auth/guards";
import { listRequests } from "@/server/queries/requests";
import { listTreatments } from "@/server/queries/treatments";
import {
  Card,
  CardContent,
  Badge,
  StatusPill,
  EmptyState,
  Button,
} from "@eins/ui";
import {
  SOURCE_LABELS,
  type RequestStatus,
  type AiCategory,
} from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { AlertTriangle, Inbox, Sparkles } from "lucide-react";
import { SourceLabel } from "@/app/_components/Brand";
import { AnfragenFilters } from "./_components/AnfragenFilters";

export const metadata = { title: "Anfragen" };

type Search = {
  status?: string;
  source?: string;
  aiCategory?: string;
  treatment?: string;
  search?: string;
  slaBreached?: string;
  stale?: string;
  page?: string;
};

// 25 rows × per-row component graph keeps the list page's HTML payload
// inside ~250 KB. Was 50 — observed shipping ~1.1 MB in dev for a single
// list render with that page size.
const PAGE_SIZE = 25;

export default async function AnfragenPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? 1));
  const statusFilter = params.status?.split(",").filter(Boolean) as RequestStatus[] | undefined;
  const sourceFilter = params.source?.split(",").filter(Boolean) as string[] | undefined;
  const aiFilter = params.aiCategory?.split(",").filter(Boolean) as AiCategory[] | undefined;
  const treatmentFilter = params.treatment?.split(",").filter(Boolean);

  const [{ items, total }, treatments] = await Promise.all([
    listRequests(
      session.clinicId,
      session.userId,
      {
        status: statusFilter,
        source: sourceFilter,
        aiCategory: aiFilter,
        treatmentId: treatmentFilter,
        search: params.search,
        slaBreachedOnly: params.slaBreached === "1",
        staleOnly: params.stale === "1",
      },
      { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
    ),
    listTreatments(session.clinicId, session.userId),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Anfragen.</h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            Alle Patienten-Anfragen an einem Ort. Schnell reagieren, nichts vergessen.
          </p>
        </div>
        <div className="text-sm text-fg-secondary">
          {total === 0
            ? "Keine Einträge"
            : `${total} Eintrag${total === 1 ? "" : "e"}`}
        </div>
      </header>

      <AnfragenFilters
        treatments={treatments.map((t) => ({ id: t.id, name: t.name }))}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="Keine Anfragen gefunden"
          description={
            params.search || params.status
              ? "Versuchen Sie es mit weniger Filtern."
              : "Sobald neue Anfragen eingehen, erscheinen sie hier."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden border-b border-border px-5 py-3 text-xs font-medium uppercase tracking-wide text-fg-tertiary md:grid md:items-center md:gap-4 md:grid-cols-[minmax(0,1.5fr)_10rem_5rem_7rem_11rem_8rem]">
              <div>Anfrage</div>
              <div>Quelle</div>
              <div className="tabular-nums">Bewertung</div>
              <div>Reaktion</div>
              <div>Status</div>
              <div className="text-right">Datum</div>
            </div>

            <ul className="grid grid-cols-[minmax(0,1fr)_auto] divide-y divide-border px-4 md:gap-x-4 md:px-5 md:grid-cols-[minmax(0,1.5fr)_10rem_5rem_7rem_11rem_8rem]">
              {items.map((r) => {
                const slaBreached =
                  !r.firstContactedAt &&
                  r.slaRespondBy &&
                  r.slaRespondBy.getTime() < Date.now();
                const ageMs = Date.now() - r.createdAt.getTime();
                const stale =
                  ageMs > 14 * 24 * 60 * 60 * 1000 && !r.firstContactedAt;
                const responseMs =
                  r.firstContactedAt && r.createdAt
                    ? r.firstContactedAt.getTime() - r.createdAt.getTime()
                    : null;
                return (
                  <li
                    key={r.id}
                    className="col-span-full grid grid-cols-subgrid"
                  >
                    <Link
                      href={`/anfragen/${r.id}`}
                      className="col-span-full grid grid-cols-subgrid items-center gap-4 py-4 transition hover:bg-bg-secondary md:py-5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-base font-semibold text-fg-primary md:text-lg">
                            {r.contactName ?? "Unbekannt"}
                          </span>
                          {(r.aiCategory || r.aiScore != null) && (
                            <Badge
                              tone={
                                r.aiCategory === "hot"
                                  ? "accent"
                                  : r.aiCategory === "warm"
                                  ? "warn"
                                  : "neutral"
                              }
                            >
                              <span className="inline-flex items-center gap-1">
                                <Sparkles className="h-3 w-3" />
                                {r.aiCategory === "hot"
                                  ? "Sehr heiß"
                                  : r.aiCategory === "warm"
                                  ? "Warm"
                                  : r.aiCategory === "cold"
                                  ? "Kalt"
                                  : null}
                                {r.aiScore != null && (
                                  <span className="tabular-nums">
                                    {r.aiCategory ? `· ${r.aiScore}` : `KI ${r.aiScore}`}
                                  </span>
                                )}
                              </span>
                            </Badge>
                          )}
                          {stale && <Badge tone="warn">Stagniert</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-sm text-fg-secondary">
                          {r.treatmentName ?? r.treatmentWish ?? "Keine Angabe zur Behandlung"}
                          {r.contactEmail ? ` · ${r.contactEmail}` : ""}
                        </div>
                      </div>

                      <div className="hidden min-w-0 truncate text-sm text-fg-primary md:block">
                        <SourceLabel
                          source={r.source}
                          label={
                            SOURCE_LABELS[
                              r.source as keyof typeof SOURCE_LABELS
                            ] ?? r.source
                          }
                        />
                      </div>

                      <div className="hidden items-center gap-1 text-sm tabular-nums text-fg-secondary md:flex">
                        <Sparkles className="h-3.5 w-3.5" />
                        {r.aiScore ?? "–"}
                      </div>
                      <div className="hidden text-sm tabular-nums text-fg-secondary md:block">
                        {responseMs == null
                          ? "—"
                          : responseMs < 60_000
                          ? "< 1 Min"
                          : responseMs < 3600_000
                          ? `${Math.round(responseMs / 60_000)} Min`
                          : `${(responseMs / 3600_000).toFixed(1).replace(".", ",")} Std`}
                      </div>

                      <div className="hidden md:block">
                        <StatusPill status={r.status} />
                      </div>

                      <div className="text-right">
                        <div className="text-sm tabular-nums text-fg-secondary">
                          {formatRelative(r.createdAt)}
                        </div>
                        {slaBreached && (
                          <div
                            className="mt-1 inline-flex items-center justify-end gap-1 text-xs text-tone-bad"
                            title={`Überfällig seit ${formatDateTime(r.slaRespondBy)}`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Überfällig
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between text-sm">
          <div className="text-fg-secondary">
            Seite {page} von {Math.ceil(total / PAGE_SIZE)}
          </div>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/anfragen?page=${page - 1}`}>← Zurück</Link>
              </Button>
            )}
            {page * PAGE_SIZE < total && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/anfragen?page=${page + 1}`}>Weiter →</Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
