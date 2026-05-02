import Link from "next/link";
import { requireSession } from "@/auth/guards";
import { listRequests, inboundCountSeries } from "@/server/queries/requests";
import { listTreatments } from "@/server/queries/treatments";
import {
  Card,
  CardContent,
  Badge,
  StatusPill,
  EmptyState,
  Button,
  Input,
  Sparkline,
} from "@eins/ui";
import {
  REQUEST_STATUS_LABELS,
  REQUEST_SOURCES,
  SOURCE_LABELS,
  AI_CATEGORIES,
  AI_CATEGORY_LABELS,
  type RequestStatus,
  type RequestSource,
  type AiCategory,
} from "@/lib/constants";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/formatting";
import { AlertTriangle, Inbox, Sparkles } from "lucide-react";

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

const PAGE_SIZE = 50;

export default async function AnfragenPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const isDetail = session.uiMode === "detail";

  const page = Math.max(1, Number(params.page ?? 1));
  const statusFilter = params.status?.split(",").filter(Boolean) as RequestStatus[] | undefined;
  const sourceFilter = params.source?.split(",").filter(Boolean) as string[] | undefined;
  const aiFilter = params.aiCategory?.split(",").filter(Boolean) as AiCategory[] | undefined;
  const treatmentFilter = params.treatment?.split(",").filter(Boolean);

  const [{ items, total }, treatments, inboundSeries] = await Promise.all([
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
    isDetail
      ? listTreatments(session.clinicId, session.userId)
      : Promise.resolve([] as Awaited<ReturnType<typeof listTreatments>>),
    isDetail
      ? inboundCountSeries(session.clinicId, session.userId, 30)
      : Promise.resolve(null),
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

      {/* Detail-only inbox sparkline */}
      {isDetail && inboundSeries && inboundSeries.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardContent className="flex items-center gap-6 p-5">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Eingang · letzte 30 Tage
              </div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {formatNumber(inboundSeries.reduce((s, v) => s + v, 0))}
              </div>
            </div>
            <div className="w-1/2">
              <Sparkline values={inboundSeries} tone="accent" height={56} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <form className="flex flex-wrap gap-3" action="/anfragen" method="GET">
        <Input
          type="search"
          name="search"
          defaultValue={params.search ?? ""}
          placeholder="Suchen: Name, E-Mail, Telefon, Wunschbehandlung …"
          className="h-11 max-w-md flex-1"
        />
        <Button type="submit">Filtern</Button>
        {(params.search ||
          params.status ||
          params.slaBreached ||
          params.aiCategory ||
          params.source ||
          params.treatment ||
          params.stale) && (
          <Button asChild type="button" variant="ghost">
            <Link href="/anfragen">Zurücksetzen</Link>
          </Button>
        )}
      </form>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {(["neu", "qualifiziert", "termin_vereinbart", "beratung_erschienen", "gewonnen", "verloren"] as RequestStatus[]).map(
          (s) => {
            const isActive = statusFilter?.includes(s);
            return (
              <Link
                key={s}
                href={`/anfragen?status=${s}`}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  isActive
                    ? "border-accent bg-accent/15 text-fg-primary"
                    : "border-border text-fg-secondary hover:bg-bg-secondary"
                }`}
              >
                {REQUEST_STATUS_LABELS[s]}
              </Link>
            );
          }
        )}
      </div>

      {/* Detail-only filter chips */}
      {isDetail && (
        <div className="space-y-2 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
              Quelle:
            </span>
            {REQUEST_SOURCES.map((s) => {
              const active = sourceFilter?.includes(s);
              return (
                <Link
                  key={s}
                  href={`/anfragen?source=${s}`}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-accent bg-accent/15 text-fg-primary"
                      : "border-border text-fg-secondary hover:bg-bg-secondary"
                  }`}
                >
                  {SOURCE_LABELS[s as RequestSource] ?? s}
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
              KI-Score:
            </span>
            {AI_CATEGORIES.map((c) => {
              const active = aiFilter?.includes(c);
              return (
                <Link
                  key={c}
                  href={`/anfragen?aiCategory=${c}`}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-accent bg-accent/15 text-fg-primary"
                      : "border-border text-fg-secondary hover:bg-bg-secondary"
                  }`}
                >
                  {AI_CATEGORY_LABELS[c]}
                </Link>
              );
            })}
            <Link
              href="/anfragen?stale=1"
              className={`rounded-full border px-3 py-1 text-xs transition ${
                params.stale === "1"
                  ? "border-accent bg-accent/15 text-fg-primary"
                  : "border-border text-fg-secondary hover:bg-bg-secondary"
              }`}
            >
              Stagniert (14+ Tage)
            </Link>
          </div>
          {treatments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Behandlung:
              </span>
              {treatments.slice(0, 8).map((t) => {
                const active = treatmentFilter?.includes(t.id);
                return (
                  <Link
                    key={t.id}
                    href={`/anfragen?treatment=${t.id}`}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      active
                        ? "border-accent bg-accent/15 text-fg-primary"
                        : "border-border text-fg-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    {t.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

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
            {(() => {
              const gridCols = isDetail
                ? "md:grid-cols-[minmax(0,1.5fr)_10rem_5rem_7rem_11rem_8rem]"
                : "md:grid-cols-[minmax(0,1.5fr)_10rem_11rem_8rem]";
              return (
                <>
                  <div
                    className={`hidden border-b border-border px-5 py-3 text-xs font-medium uppercase tracking-wide text-fg-tertiary md:grid md:items-center md:gap-4 ${gridCols}`}
                  >
                    <div>Anfrage</div>
                    <div>Quelle</div>
                    {isDetail && <div className="tabular-nums">Score</div>}
                    {isDetail && <div>Reaktion</div>}
                    <div>Status</div>
                    <div className="text-right">Datum</div>
                  </div>

                  <ul
                    className={`grid grid-cols-[minmax(0,1fr)_auto] divide-y divide-border px-4 md:gap-x-4 md:px-5 ${gridCols}`}
                  >
                    {items.map((r) => {
                      const slaBreached =
                        !r.firstContactedAt &&
                        r.slaRespondBy &&
                        r.slaRespondBy.getTime() < Date.now();
                      const ageMs = Date.now() - r.createdAt.getTime();
                      const stale =
                        isDetail && ageMs > 14 * 24 * 60 * 60 * 1000 && !r.firstContactedAt;
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
                                {r.aiCategory && (
                                  <Badge
                                    tone={
                                      r.aiCategory === "hot"
                                        ? "accent"
                                        : r.aiCategory === "warm"
                                        ? "warn"
                                        : "neutral"
                                    }
                                  >
                                    {r.aiCategory === "hot"
                                      ? "Sehr heiß"
                                      : r.aiCategory === "warm"
                                      ? "Warm"
                                      : "Kalt"}
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
                              {SOURCE_LABELS[r.source as keyof typeof SOURCE_LABELS] ?? r.source}
                            </div>

                            {isDetail && (
                              <div className="hidden items-center gap-1 text-sm tabular-nums text-fg-secondary md:flex">
                                <Sparkles className="h-3.5 w-3.5" />
                                {r.aiScore ?? "–"}
                              </div>
                            )}
                            {isDetail && (
                              <div className="hidden text-sm tabular-nums text-fg-secondary md:block">
                                {responseMs == null
                                  ? "—"
                                  : responseMs < 60_000
                                  ? "< 1 Min"
                                  : responseMs < 3600_000
                                  ? `${Math.round(responseMs / 60_000)} Min`
                                  : `${(responseMs / 3600_000).toFixed(1).replace(".", ",")} Std`}
                              </div>
                            )}

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
                </>
              );
            })()}
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
