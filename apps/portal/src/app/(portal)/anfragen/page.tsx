import { Suspense } from "react";
import Link from "next/link";
import { requireSession } from "@/auth/guards";
import type { ResolvedSession } from "@/auth/session";
import {
  aiCategoryCounts,
  listRequests,
  nextCallQueueLeads,
} from "@/server/queries/requests";
import { dueFollowups } from "@/server/queries/followups";
import { listTreatments } from "@/server/queries/treatments";
import { cacheClinicQuery } from "@/server/queries/_cache";
import { can } from "@/lib/roles";
import {
  Card,
  CardContent,
  StatusPill,
  EmptyState,
  Button,
  ExplainerPopover,
} from "@eins/ui";
import { SOURCE_LABELS } from "@/lib/constants";
import { formatMoney, formatRelative } from "@/lib/formatting";
import { Download, Inbox, UserPlus } from "lucide-react";
import { AnfragenFilters } from "./_components/AnfragenFilters";
import { CallQueue } from "./_components/CallQueue";
import { TimingLine } from "./_components/TimingLine";
import { AI_SCORE_EXPLANATION, aiCategoryWord, aiScoreText } from "./_lib/ai-score";
import { rowTiming } from "./_lib/row-timing";
import { responseRuleStartForClinic } from "@/server/guarantee-clock";
import { RequestListSkeleton } from "./_components/RequestListSkeleton";
import { ChapterLaunchLink } from "@/app/(portal)/_components/tour/ChapterLaunchLink";
import {
  hasListFilter,
  listQueryString,
  parseAnfragenParams,
  type AnfragenSearchParams,
} from "./_lib/list-params";

export const metadata = { title: "Anfragen" };

type Search = AnfragenSearchParams;

// Treatments change rarely and do not depend on the list filters; without a
// cache every keystroke in the search box re-read them (D-19).
const listTreatmentsCached = cacheClinicQuery("anfragenTreatments", listTreatments, {
  revalidate: 300,
});

// 25 rows × per-row component graph keeps the list page's HTML payload
// inside ~250 KB. Was 50 — observed shipping ~1.1 MB in dev for a single
// list render with that page size.
const PAGE_SIZE = 25;

/** Desktop columns: Anfrage, Status, KI-Bewertung, Umsatz. Header and rows share it. */
const LIST_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_10rem_7.5rem_6.5rem]";

const LTV_HINT = "Gesamtumsatz dieses Patienten über alle Behandlungen";

export default async function AnfragenPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const isFrontdesk = session.role === "frontdesk";
  const isInhaber = session.role === "inhaber";
  // "Anfrage anlegen" (Empfang): everyone who works Anfragen.
  const canCreate = can(session.role, "requests.update");

  return (
    <div className="space-y-6">
      <header
        data-tour="anfragen-header"
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Anfragen.</h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            {isFrontdesk
              ? "Anfragen bearbeiten und anrufen. Die dringendsten zuerst."
              : "Alle Patienten-Anfragen an einem Ort. Schnell reagieren, nichts vergessen."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isInhaber && <ChapterLaunchLink chapter="anfragen" />}
          {canCreate && (
            <Button asChild size="sm">
              <Link href="/anfragen/neu">
                <UserPlus className="h-4 w-4" aria-hidden />
                Anfrage anlegen
              </Link>
            </Button>
          )}
        </div>
      </header>

      <Suspense fallback={<FiltersSkeleton />}>
        <FiltersLoader session={session} />
      </Suspense>

      <Suspense fallback={<RequestListSkeleton />}>
        <RequestListLoader session={session} params={params} />
      </Suspense>
    </div>
  );
}

/**
 * Filter-Chrome streamt unabhängig von der schweren Liste: die Badge-Counts
 * (Behandlungen + KI-Kategorien) sind günstige Aggregat-Queries, deren
 * Latenz die Liste nicht blockieren soll.
 */
async function FiltersLoader({ session }: { session: ResolvedSession }) {
  const [treatments, aiCounts] = await Promise.all([
    listTreatmentsCached(session.clinicId, session.userId),
    aiCategoryCounts(session.clinicId, session.userId),
  ]);

  return (
    <AnfragenFilters
      treatments={treatments.map((t) => ({ id: t.id, name: t.name }))}
      aiCounts={aiCounts}
    />
  );
}

function FiltersSkeleton() {
  return (
    <div
      className="h-12 w-full animate-pulse rounded-xl bg-bg-secondary"
      aria-busy="true"
    />
  );
}

async function RequestListLoader({
  session,
  params,
}: {
  session: ResolvedSession;
  params: Search;
}) {
  // Validated: unknown values from old or hand-edited links are dropped
  // instead of failing in the database (C-22).
  const list = parseAnfragenParams(params);
  const { page, sort } = list;
  const filtered = hasListFilter(list);

  // Call-queue is only useful when there are no filters applied: once the
  // team filters down to "spam" or one specific treatment, surfacing a hero
  // "Jetzt anrufen" card from a different priority slice would be misleading.
  // Shown to everyone who works Anfragen (C-20): in small Praxen the
  // Inhaberin calls back herself, and her Wiedervorlagen must surface too.
  const showCallQueue =
    can(session.role, "requests.update") && page === 1 && !filtered;
  const canExport = can(session.role, "requests.view");

  const [{ items, total }, callQueue, dueList, ruleStart] = await Promise.all([
    listRequests(
      session.clinicId,
      session.userId,
      {
        status: list.status,
        source: list.source,
        aiCategory: list.aiCategory,
        treatmentId: list.treatmentId,
        search: list.search,
        slaBreachedOnly: list.slaBreachedOnly,
        staleOnly: list.staleOnly,
      },
      { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, sort }
    ),
    showCallQueue
      ? nextCallQueueLeads(session.clinicId, session.userId, 6)
      : Promise.resolve([]),
    showCallQueue
      ? dueFollowups(session.clinicId, session.userId)
      : Promise.resolve([]),
    // K-3: no "nicht beantwortet" for inquiries before the signing date.
    responseRuleStartForClinic(session.clinicId),
  ]);
  const now = new Date();

  return (
    <div className="space-y-6">
      {showCallQueue && callQueue.length > 0 && (
        <CallQueue
          leads={callQueue}
          dueCount={dueList.length}
          // No country column on clinics; CHF billing means a Swiss Praxis.
          countryCode={session.currency === "CHF" ? "41" : "49"}
          ruleStart={ruleStart}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-fg-primary">
            {total === 0
              ? "Keine Einträge"
              : `${total} ${total === 1 ? "Eintrag" : "Einträge"}`}
          </span>
          {/* Phones have no column header, so the score explanation sits here. */}
          {total > 0 && (
            <span className="inline-flex items-center text-sm text-fg-primary lg:hidden">
              Was heißt die KI-Bewertung?
              <ExplainerPopover term="KI-Bewertung" ariaLabel="Erklärung zur KI-Bewertung">
                {AI_SCORE_EXPLANATION}
              </ExplainerPopover>
            </span>
          )}
        </div>
        {canExport && total > 0 && (
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/requests/export${
                listQueryString(params) ? `?${listQueryString(params)}` : ""
              }`}
              download
            >
              <Download className="h-4 w-4" />
              {filtered ? "Auswahl als CSV herunterladen" : "Alle als CSV herunterladen"}
            </a>
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="Keine Anfragen gefunden"
          description={
            filtered
              ? "Versuchen Sie es mit weniger Filtern."
              : "Sobald neue Anfragen eingehen, erscheinen sie hier."
          }
        />
      ) : (
        <Card data-tour="anfragen-list">
          <CardContent className="p-0">
            {/* Desktop: one fixed grid, so status, score and Umsatz line up
                in their own columns on every row. Phones: the same facts
                sit in one line under the name, status first. */}
            <div className={`hidden border-b border-border px-5 py-3 text-sm font-medium text-fg-primary lg:grid lg:items-center lg:gap-x-4 ${LIST_COLUMNS}`}>
              <div>Anfrage</div>
              <div>Status</div>
              <div className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                KI-Bewertung
                <ExplainerPopover term="KI-Bewertung" ariaLabel="Erklärung zur KI-Bewertung">
                  {AI_SCORE_EXPLANATION}
                </ExplainerPopover>
              </div>
              <div className="text-right" title={LTV_HINT}>Umsatz</div>
            </div>

            <ul className={`grid grid-cols-1 divide-y divide-border px-4 md:px-5 lg:gap-x-4 ${LIST_COLUMNS}`}>
              {items.map((r) => {
                const timing = rowTiming(
                  {
                    createdAt: r.createdAt,
                    firstAttemptAt: r.firstAttemptAt,
                    status: r.status,
                    ruleStart,
                    firstContactedAt: r.firstContactedAt,
                    slaRespondBy: r.slaRespondBy,
                  },
                  now
                );
                const score =
                  r.aiScore != null ? aiScoreText(r.aiScore) : aiCategoryWord(r.aiCategory);
                const ltv =
                  r.patientLtv != null && r.patientLtv > 0
                    ? formatMoney(r.patientLtv, session.currency)
                    : null;
                const source =
                  SOURCE_LABELS[r.source as keyof typeof SOURCE_LABELS] ?? r.source;
                return (
                  <li key={r.id} className="col-span-full grid grid-cols-subgrid">
                    <Link
                      href={`/anfragen/${r.id}`}
                      className="col-span-full grid grid-cols-subgrid items-baseline gap-y-1 py-4 transition hover:bg-bg-secondary md:py-5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="truncate text-base font-semibold text-fg-primary md:text-lg">
                          {r.contactName ?? "Unbekannt"}
                        </div>
                        {/* Phones only: status and facts in one line. */}
                        <div className="flex min-w-0 items-center gap-x-1.5 text-sm text-fg-secondary lg:hidden">
                          <StatusPill status={r.status} />
                          {score && (
                            <span className="whitespace-nowrap tabular-nums">· KI {score}</span>
                          )}
                          {ltv && <span className="whitespace-nowrap tabular-nums">· {ltv}</span>}
                        </div>
                        <div className="truncate text-sm text-fg-secondary">
                          {[
                            r.treatmentName ?? r.treatmentWish ?? "Keine Angabe zur Behandlung",
                            source,
                            formatRelative(r.createdAt),
                          ].join(" · ")}
                        </div>
                        <TimingLine timing={timing} className="max-w-full" />
                      </div>

                      <div className="hidden lg:block">
                        <StatusPill status={r.status} />
                      </div>

                      <div
                        className="hidden whitespace-nowrap text-right text-sm tabular-nums text-fg-primary lg:block"
                        title={score ? AI_SCORE_EXPLANATION : undefined}
                      >
                        {score}
                      </div>

                      <div
                        className="hidden whitespace-nowrap text-right text-sm font-medium tabular-nums text-fg-primary lg:block"
                        title={ltv ? LTV_HINT : undefined}
                      >
                        {ltv}
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
                <Link href={`/anfragen?${listQueryString(params, page - 1)}`}>
                  ← Zurück
                </Link>
              </Button>
            )}
            {page * PAGE_SIZE < total && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/anfragen?${listQueryString(params, page + 1)}`}>
                  Weiter →
                </Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
