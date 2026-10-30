import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/auth/guards";
import type { ResolvedSession } from "@/auth/session";
import {
  listRequests,
  nextCallQueueLeads,
} from "@/server/queries/requests";
import { dueFollowups } from "@/server/queries/followups";
import { retreatmentCallQueue, retreatmentTagsForRequests } from "@/server/queries/retreatments";
import { listTreatments } from "@/server/queries/treatments";
import { cacheClinicQuery } from "@/server/queries/_cache";
import { can } from "@/lib/roles";
import { Button, StatusPill, cn } from "@eins/ui";
import { ALL_REQUEST_STATUS_LABELS, type AnyRequestStatus } from "@/lib/constants";
import { reportingChannel, reportingChannelLabel } from "@/lib/sources";
import { berlinDay } from "@/lib/retreatment";
import { formatMoney, formatNumber, formatRelative } from "@/lib/formatting";
import { withBrandLogos } from "@/app/_components/Brand";
import { NavTransition, PagerNav, PendingDim, PendingLink, PendingPage } from "@/app/_components/instant-views";
import { ChevronLeft, ChevronRight, Download, UserPlus, X } from "lucide-react";
import {
  CONTROL,
  DashCard,
  QUIET_CONTROL,
  RAISED_CONTROL,
  TABLE_HEAD_BAND,
  TABLE_ROW,
} from "../dashboard/_components/dash-ui";
import { CardEmptyNote } from "../dashboard/_components/card-notes";
import { AnfragenFilters, AnfragenFiltersSkeleton } from "./_components/AnfragenFilters";
import { CallQueue, CALLS_LOADED } from "./_components/CallQueue";
import { RetreatmentTag } from "./_components/RetreatmentTag";
import { PageHeader } from "../_components/PageHeader";
import { RowSignal } from "./_components/RowSignal";
import { Facts } from "./_components/Facts";
import { mergeCallItems } from "./_lib/call-items";
import { listTagText } from "./_lib/retreatment-text";
import { rowTiming } from "./_lib/row-timing";
import { responseRuleForClinic } from "@/server/guarantee-clock";
import { RequestListSkeleton } from "./_components/RequestListSkeleton";
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

/**
 * Calls loaded per queue: the 6 on screen (hero plus 5 rows) and 2 in reserve,
 * so a tapped result can show the next call at once (CallQueueState) while the
 * server still answers.
 */
const CALL_LOAD = CALLS_LOADED;

/**
 * Columns of the list, shared by the header and every row (Stripe's table:
 * fixed figure columns, the name takes the rest). Every row is one line from
 * lg, so all rows have the same height (Linear's issue list); the signal
 * (Frist, "nicht beantwortet") is an icon in front of the name. lg shows
 * Behandlung, Status, Eingang and Umsatz; Quelle (the channel) joins from
 * 1360 px, sized for the longest one with its icon ("Direkt (ohne
 * Kennzeichnung)"). Below lg each
 * row is exactly two lines (Linear's inbox): name and date, then status,
 * Behandlung and the Umsatz.
 */
const LIST_COLUMNS =
  "lg:grid-cols-[minmax(0,1fr)_8.5rem_9.5rem_5.5rem_5.5rem] min-[1360px]:grid-cols-[minmax(0,1fr)_8.5rem_15.5rem_9.5rem_5.5rem_5.5rem]";

/** Room the signal slot takes before a name: the 16 px icon and its gap. */
const SIGNAL_INDENT = "pl-[1.625rem]";

const LTV_HINT = "Gesamtumsatz dieses Patienten über alle Behandlungen";

export default async function AnfragenPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  // "Anfrage anlegen" (Empfang): everyone who works Anfragen.
  const canCreate = can(session.role, "requests.update");
  // Same rule as `showCallQueue` below, so the skeleton has the call cards
  // exactly when the page will.
  const listParams = parseAnfragenParams(params);
  const expectCallQueue = canCreate && listParams.page === 1 && !hasListFilter(listParams);

  return (
    <>
      {/* From md the nav already says where we are: the toolbar is the first
          row and carries "Anfrage anlegen" at its right end (Attio, Notion).
          On the phone the title row stays, with the button beside it. Outside
          the stack, so the hidden heading adds no spacing step from md. */}
      <PageHeader
        title="Anfragen"
        className="mb-4 md:sr-only"
        actions={
          canCreate && (
            <Button asChild className={cn(CONTROL, "px-4 md:hidden")}>
              <Link href="/anfragen/neu">
                <UserPlus className="h-4 w-4" aria-hidden />
                Anfrage anlegen
              </Link>
            </Button>
          )
        }
      />
      {/* The server filters and pages (the list is unbounded): the controls
          show the new value on the tap, the rows of "Alle Anfragen" dim at the
          same size until the new ones arrive. The call cards stay as they are. */}
      <NavTransition>
      <div className="space-y-4 md:space-y-6">
        <Suspense fallback={<AnfragenFiltersSkeleton canCreate={canCreate} />}>
          <FiltersLoader session={session} canCreate={canCreate} />
        </Suspense>

        <Suspense
          fallback={<RequestListSkeleton callQueue={expectCallQueue} />}
        >
          <RequestListLoader session={session} params={params} />
        </Suspense>
      </div>
      </NavTransition>
    </>
  );
}

/**
 * Filter-Chrome streamt unabhängig von der schweren Liste.
 */
async function FiltersLoader({
  session,
  canCreate,
}: {
  session: ResolvedSession;
  canCreate: boolean;
}) {
  const treatments = await listTreatmentsCached(session.clinicId, session.userId);

  return (
    <AnfragenFilters
      treatments={treatments.map((t) => ({ id: t.id, name: t.name }))}
      canCreate={canCreate}
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

  const [{ items, total }, callQueue, dueList, responseRule, retreatmentCalls] = await Promise.all([
    listRequests(
      session.clinicId,
      session.userId,
      {
        status: list.status,
        channel: list.channel,
        treatmentId: list.treatmentId,
        search: list.search,
        slaBreachedOnly: list.slaBreachedOnly,
        staleOnly: list.staleOnly,
        retreatment: list.retreatment,
      },
      { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, sort }
    ),
    showCallQueue
      ? nextCallQueueLeads(session.clinicId, session.userId, CALL_LOAD)
      : Promise.resolve([]),
    showCallQueue
      ? dueFollowups(session.clinicId, session.userId)
      : Promise.resolve([]),
    // K-3: no "nicht beantwortet" for inquiries before the signing date.
    responseRuleForClinic(session.clinicId),
    showCallQueue
      ? retreatmentCallQueue(session.clinicId, session.userId, CALL_LOAD)
      : Promise.resolve(null),
  ]);
  // The Wiederbehandlung of each row on this page, shown as its status tag
  // (an Anfrage still worked keeps its status, except in the Wiederbehandlung
  // filter, where every row is there for its tag), and of each Anfrage in the
  // call cards, named in its card.
  const [tags, callTags] = await Promise.all([
    retreatmentTagsForRequests(
      session.clinicId,
      session.userId,
      items.map((r) => r.id),
      { includeWorking: !!list.retreatment?.includes("offen") }
    ),
    retreatmentTagsForRequests(
      session.clinicId,
      session.userId,
      callQueue.map((l) => l.id),
      { includeWorking: true }
    ),
  ]);
  const now = new Date();
  const today = berlinDay(now);
  const pages = Math.ceil(total / PAGE_SIZE);
  const query = listQueryString(params);
  // What is on screen, in the order and with the Wiederbehandlung place the
  // queue always had, then the reserve behind it for the optimistic tap.
  const visibleCalls = showCallQueue ? mergeCallItems(callQueue, retreatmentCalls?.calls ?? [], now) : [];
  const widerCalls = showCallQueue ? mergeCallItems(callQueue, retreatmentCalls?.calls ?? [], now, CALL_LOAD) : [];
  const shown = new Set(visibleCalls.map((c) => c.key));
  const callItems = [...visibleCalls, ...widerCalls.filter((c) => !shown.has(c.key))];
  // The Wiederbehandlung mergeCallItems forced into the last visible place:
  // the wider merge has something else there.
  const lastCall = visibleCalls[visibleCalls.length - 1];
  const forcedCallKey =
    visibleCalls.length === 6 && lastCall?.kind === "wiederbehandlung" && widerCalls[5]?.key !== lastCall.key
      ? lastCall.key
      : null;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Also with nobody to call: the cards keep their place and size
          (DESIGN.md section 10, "Fixed size") and match the skeleton. */}
      {showCallQueue && (
        <CallQueue
          // Due Wiederbehandlungen among the calls (Karam, 2026-10-29: no
          // card of their own), after the Anfragen that go cold first.
          items={callItems}
          forcedKey={forcedCallKey}
          retreatment={retreatmentCalls}
          callTags={callTags}
          dueCount={dueList.length}
          // No country column on clinics; CHF billing means a Swiss Praxis.
          countryCode={session.currency === "CHF" ? "41" : "49"}
          responseRule={responseRule}
        />
      )}

      {/* The list as one card, like Stripe's tables: the count beside the
          title, the export as the card's one action, the pages at the foot. */}
      <DashCard
        title={
          <>
            {filtered ? "Auswahl" : "Alle Anfragen"}
            {total > 0 && (
              <span className="ml-2 font-normal tabular-nums text-fg-secondary">
                {formatNumber(total)}
              </span>
            )}
          </>
        }
        action={
          // One height with or without the buttons, so the header does not
          // change when a filter finds nothing. "Filter zurücksetzen" sits
          // here rather than in the filter row, where it wrapped the row
          // (DESIGN.md section 10, "Fixed size").
          <div className="flex h-[var(--control-h)] items-center gap-2">
            {filtered && (
              <PendingLink
                href="/anfragen"
                aria-label="Filter zurücksetzen"
                className={cn(QUIET_CONTROL, "justify-center max-sm:w-[var(--control-h)] max-sm:px-0")}
              >
                <X className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Filter zurücksetzen</span>
              </PendingLink>
            )}
            {canExport && total > 0 && (
            <Button asChild variant="outline" size="sm" className={cn(RAISED_CONTROL, CONTROL)}>
              <a
                href={`/api/requests/export${query ? `?${query}` : ""}`}
                download
                aria-label={filtered ? "Auswahl als CSV herunterladen" : "Alle als CSV herunterladen"}
              >
                <Download className="h-4 w-4" aria-hidden />
                <span>
                  <span className="hidden sm:inline">Als </span>CSV
                  <span className="hidden sm:inline"> herunterladen</span>
                </span>
              </a>
            </Button>
            )}
          </div>
        }
        className="flex flex-col [--delay:40ms]"
        bodyClassName="flex flex-1 flex-col"
      >
        <PendingDim className="flex flex-1 flex-col">
        {items.length === 0 ? (
          <CardEmptyNote>
            {filtered
              ? "Zu diesen Filtern gibt es keine Anfragen."
              : "Neue Anfragen erscheinen hier, sobald sie eingehen."}
          </CardEmptyNote>
        ) : (
          // -mx-2: row text lines up with the card title, the hover wash
          // reaches into the card padding.
          <div className="-mx-2">
            {/* The header as a band pressed into the card (Linear). */}
            <div
              aria-hidden
              className={cn("mb-1 hidden items-center gap-x-4 px-2 lg:grid", TABLE_HEAD_BAND, LIST_COLUMNS)}
            >
              <span className={SIGNAL_INDENT}>Anfrage</span>
              <span>Behandlung</span>
              <span className="hidden min-[1360px]:block">Quelle</span>
              <span>Status</span>
              <span>Eingang</span>
              <span className="text-right" title={LTV_HINT}>
                Umsatz
              </span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((r) => {
                const timing = rowTiming(
                  {
                    createdAt: r.createdAt,
                    firstAttemptAt: r.firstAttemptAt,
                    status: r.status,
                    ...responseRule,
                    firstContactedAt: r.firstContactedAt,
                    slaRespondBy: r.slaRespondBy,
                  },
                  now
                );
                const ltv =
                  r.patientLtv != null && r.patientLtv > 0
                    ? formatMoney(r.patientLtv, session.currency)
                    : null;
                // The channel, as the Quellen card counts it (Instagram-Beitrag,
                // Profil-Link, Meta-Anzeige), not the technical entry point.
                const source = withBrandLogos(
                  reportingChannelLabel(reportingChannel({ source: r.source, utm: r.utm }))
                );
                const treatment = r.treatmentName ?? r.treatmentWish ?? "Keine Angabe";
                const received = formatRelative(r.createdAt);
                // A Wiederbehandlung shows where the status is: the Anfrage
                // itself is done (the query leaves out Anfragen still worked).
                const tag = tags.get(r.id);
                const status = tag ? (
                  <RetreatmentTag
                    state={tag.state}
                    text={listTagText(
                      tag,
                      today,
                      ALL_REQUEST_STATUS_LABELS[r.status as AnyRequestStatus] ?? r.status
                    )}
                  />
                ) : (
                  <StatusPill status={r.status} />
                );
                return (
                  <li key={r.id}>
                    <Link
                      href={`/anfragen/${r.id}`}
                      className={cn(
                        "grid items-center gap-x-4 px-2 py-3 hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent lg:py-2",
                        TABLE_ROW,
                        LIST_COLUMNS
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <RowSignal timing={timing} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            {/* Long names wrap, never cut. */}
                            <span className="min-w-0 break-words text-[15px] font-medium leading-5 text-fg-primary">
                              {r.contactName ?? "Unbekannt"}
                            </span>
                            <span className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary lg:hidden">
                              {received}
                            </span>
                          </div>
                          {/* Below lg the second and last line: status and
                              Behandlung. The Umsatz is left out here: with it
                              the line wrapped to a third on the phone (DESIGN.md:
                              fewer columns, never a taller row or a cut). It is
                              in its column from lg and on the Anfrage itself. */}
                          <Facts className="mt-1 lg:hidden">
                            {status}
                            {treatment}
                          </Facts>
                        </div>
                      </div>
                      <Cell className="hidden break-words lg:block">{treatment}</Cell>
                      <Cell className="hidden min-[1360px]:block">{source}</Cell>
                      <span className="hidden leading-5 lg:block">{status}</span>
                      <Cell className="hidden tabular-nums lg:block">{received}</Cell>
                      <Cell className="hidden text-right font-medium tabular-nums lg:block">
                        {ltv && (
                          <span title={LTV_HINT}>
                            <span className="sr-only">Umsatz: </span>
                            {ltv}
                          </span>
                        )}
                      </Cell>
                    </Link>
                  </li>
                );
              })}
              {/* The last page of a longer list fills up to a full page, so
                  "Zurück" and "Weiter" stay where they were. The fillers have
                  the shape of a row and are not shown. */}
              {pages > 1 &&
                Array.from({ length: PAGE_SIZE - items.length }, (_, i) => (
                  <li key={`filler-${i}`} aria-hidden className="invisible">
                    <div className={cn("grid items-center gap-x-4 px-2 py-3 lg:py-2", TABLE_ROW, LIST_COLUMNS)}>
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="h-5 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] leading-5">&nbsp;</div>
                          <div className="mt-1 lg:hidden">
                            <Facts className="mt-0">
                              <StatusPill status="neu" />
                              {" "}
                            </Facts>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* Pages at the foot of the card, like Stripe's table footer. The
            number follows the tap; the pager keeps its place on screen
            although the call cards show only on page 1. */}
        {pages > 1 && (
          <PagerNav
            anchor="anfragen"
            page={page}
            aria-label="Seiten"
            className="-mx-2 mt-auto flex items-center justify-between gap-3 border-t border-border px-2 pt-3"
          >
            <span className="text-sm tabular-nums text-fg-secondary">
              Seite <PendingPage /> von {pages}
            </span>
            {/* Both buttons on every page, greyed out at the ends (Stripe), so
                neither moves when the first or last page is reached. */}
            <div className="flex gap-2">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm" className={cn(RAISED_CONTROL, CONTROL)}>
                  <PendingLink href={`/anfragen?${listQueryString(params, page - 1)}`}>
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    Zurück
                  </PendingLink>
                </Button>
              ) : (
                <Button disabled variant="outline" size="sm" className={cn(RAISED_CONTROL, CONTROL)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Zurück
                </Button>
              )}
              {/* The next page loads once "Weiter" is on screen or hovered, so
                  the click shows it at once (Karam, 2026-10-30). Next keeps it
                  up to 5 minutes (staleTimes.static); an action that
                  revalidates clears it. Production only: dev never prefetches. */}
              {page < pages ? (
                <Button asChild variant="outline" size="sm" className={cn(RAISED_CONTROL, CONTROL)}>
                  <PendingLink prefetch href={`/anfragen?${listQueryString(params, page + 1)}`}>
                    Weiter
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </PendingLink>
                </Button>
              ) : (
                <Button disabled variant="outline" size="sm" className={cn(RAISED_CONTROL, CONTROL)}>
                  Weiter
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </PagerNav>
        )}
        </PendingDim>
      </DashCard>
    </div>
  );
}

/** One figure of a row in its fixed column (Stripe's table cell). */
function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("min-w-0 text-[15px] leading-5 text-fg-primary", className)}>
      {children}
    </span>
  );
}
