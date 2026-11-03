import { notFound } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { responseRuleForClinic } from "@/server/guarantee-clock";
import {
  getRequestWithActivities,
  markRequestViewed,
} from "@/server/queries/requests";
import { listFollowupsForRequest } from "@/server/queries/followups";
import { retreatmentsForRequest } from "@/server/queries/retreatments";
import { leadTokenForRequestId } from "@/server/pvs-token";
import { can } from "@/lib/roles";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { DashCard, QUIET_CONTROL } from "../../dashboard/_components/dash-ui";
import { CallResult, Composer } from "./_lead-cockpit";
import { RetreatmentSection } from "./_retreatment";
import { PendingProvider } from "./_pending";
import { type ClockInput } from "./_live-status";
import { Verlauf } from "./_verlauf";
import { DetailsCard } from "./_details";
import {
  MobileActionBar,
  RecordCard,
  SiblingsCard,
  type PvsRow,
} from "./_record";
import {
  DETAIL_GRID,
  MESSAGE_HEIGHT,
  ORDER,
  PAIR_COLUMNS,
  detailColumns,
} from "./_lib/sizes";
import { quizAnswerLines } from "../_lib/quiz-answers";
import { quizFromSignals } from "@/server/queries/requests";
import {
  siblingRequests,
  patientLifetimeRevenue,
} from "@/server/queries/patients";
import { reportingChannel, reportingChannelLabel } from "@/lib/sources";
import { withBrandLogos } from "@/app/_components/Brand";
import { responseInfo } from "@/lib/response-time";
import { rowTiming, statusImpliesContact } from "../_lib/row-timing";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Anfrage" };

/** A wish up to this length is the "Behandlung" row (the call card's limit); longer ones stand in the message. */
const WISH_IN_ROW_MAX = 40;

/**
 * One Anfrage, for the person about to call or just off the phone. It
 * answers, in this order: who is it and how do I reach them, what do they
 * want and what did they tell us, what is due and by when, what happened so
 * far; and it logs what was just done, in one tap where it can. The record
 * (Attio's record page) comes first; from xl it is the column on the right
 * beside the message and the work on it, as on the Rückmeldung. Every card
 * keeps one height per breakpoint, saves show at once (_pending.tsx) and
 * report as a toast. What is kept but not needed in the call sits one level
 * deeper in "Details".
 */
export default async function AnfrageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  // Cheap pre-flight so a malformed id surfaces a clean 404 instead of a
  // PG "invalid input syntax for type uuid" 500.
  if (!isUuid(id)) notFound();

  const canWork = can(session.role, "requests.update");
  // Technical raw data are owner-only (`audit.view`, C-27).
  const canAudit = can(session.role, "audit.view");

  // D-6: everything that only needs the id or the clinic starts together
  // with the main query instead of after it. All of these are clinic-scoped
  // (RLS or an explicit clinic_id filter), so a foreign id leaks nothing.
  const sidePromise = Promise.all([
    siblingRequests(session.clinicId, session.userId, id),
    db
      .select({
        vendor: schema.pvsLink.pvsVendor,
        status: schema.pvsLink.status,
      })
      .from(schema.pvsLink)
      .where(eq(schema.pvsLink.clinicId, session.clinicId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    listFollowupsForRequest(session.clinicId, session.userId, id),
    // K-3: rule start of this Praxis (signing date) for the response badge.
    responseRuleForClinic(session.clinicId),
    retreatmentsForRequest(session.clinicId, session.userId, id),
  ]);
  // Not awaited on the 404 path; keep a failure there from becoming an
  // unhandled rejection. The real await below still sees the error.
  sidePromise.catch(() => {});

  const data = await getRequestWithActivities(
    session.clinicId,
    session.userId,
    id,
  );
  if (!data) notFound();
  const {
    request,
    activities,
    treatmentName,
    locationName,
    firstAttemptAt,
    postTitle,
  } = data;

  // Durable PHI-read access trace (DSGVO Art. 30/32) — record who opened which
  // patient record (pentest L2). Deferred so it never blocks the render;
  // requestMeta:{} keeps writeAudit from re-entering headers() after flush.
  after(() =>
    writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      action: "view",
      entityKind: "request",
      entityId: id,
      requestMeta: {},
      impersonatedByAdminId: session.impersonatedByAdminId,
    }),
  );

  // Clear the sidebar "neu" badge the first time anyone opens this lead.
  // markRequestViewed is idempotent (no-op once firstViewedAt is set) and
  // best-effort; it runs after the response so the write no longer blocks
  // the render (D-6). The badge cache has a short TTL as the safety net.
  if (request.status === "neu" && request.firstViewedAt === null) {
    after(() => markRequestViewed(session.clinicId, session.userId, id));
  }

  const [
    [siblings, pvsLinkRow, followups, responseRule, retreatments],
    patientLtv,
  ] = await Promise.all([
    sidePromise,
    request.patientId
      ? patientLifetimeRevenue(
          session.clinicId,
          session.userId,
          request.patientId,
        )
      : Promise.resolve(null),
  ]);
  const quizAnswers = quizAnswerLines(quizFromSignals(request.aiSignals));

  const name = request.contactName?.trim() || "Unbekannt";
  const pvsControlled = request.pvsAppointmentId !== null;

  // Direction A: only surface the EINS-Lead token while the request hasn't
  // already been linked to a PVS appointment. Once linked, the token has
  // served its purpose; the row then says that it is linked.
  const pvs: PvsRow =
    pvsLinkRow === null || pvsLinkRow.status !== "connected"
      ? null
      : request.pvsAppointmentId !== null
        ? { linked: true }
        : {
            linked: false,
            token: leadTokenForRequestId(id),
            vendor: pvsLinkRow.vendor ?? null,
          };

  // 48-Werkstunden rule (Kanon 6a). Separate from the internal 3-hour SLA:
  // this one has contractual consequences for the Praxis.
  const now = new Date();
  const response = responseInfo(
    {
      createdAt: request.createdAt,
      firstAttemptAt,
      status: request.status,
      ...responseRule,
    },
    now,
  );

  // Termin vereinbart or later without a logged attempt: the person was
  // reached anyway, so no deadline warnings (same rule as the list, rowTiming).
  const contactImplied =
    statusImpliesContact(request.status) && !firstAttemptAt;

  const slaBreached =
    !contactImplied &&
    !request.firstContactedAt &&
    !!request.slaRespondBy &&
    request.slaRespondBy.getTime() < now.getTime();

  const clock: ClockInput = {
    createdAt: request.createdAt,
    firstContactedAt: request.firstContactedAt,
    firstAttemptAt,
    slaRespondBy: request.slaRespondBy,
    rule: responseRule,
    status: request.status,
    server: {
      // The same line as the row in the list and on the call card.
      timing: rowTiming(
        {
          createdAt: request.createdAt,
          firstAttemptAt,
          status: request.status,
          ...responseRule,
          firstContactedAt: request.firstContactedAt,
          slaRespondBy: request.slaRespondBy,
        },
        now,
      ),
      response,
      slaBreached,
      contactImplied,
    },
  };

  // What they want: the treatment, or a short wish; a long wish goes into
  // the message well with the other answers (the call card's rule).
  const wish = request.treatmentWish?.trim() || null;
  const wishInRow = !treatmentName && !!wish && wish.length <= WISH_IN_ROW_MAX;
  const treatment = {
    text: treatmentName ?? (wishInRow ? wish : null),
    inMessage: !treatmentName && !!wish,
  };
  // The form's budget field and the quiz's budget answer are two facts; the
  // field keeps the old page's "Budget-Angabe" when the quiz has a "Budget".
  const budgetLabel = quizAnswers.some((a) => a.label === "Budget")
    ? "Budget-Angabe"
    : "Budget";
  const pairs = [
    ...(wish && !wishInRow && wish !== treatmentName
      ? [{ label: "Wunsch", value: wish }]
      : []),
    ...(request.budgetIndication
      ? [{ label: budgetLabel, value: request.budgetIndication }]
      : []),
    ...quizAnswers,
  ];

  const rawPayload =
    canAudit &&
    !!request.rawPayload &&
    typeof request.rawPayload === "object" &&
    Object.keys(request.rawPayload as Record<string, unknown>).length > 0
      ? request.rawPayload
      : null;
  // The record lines up with Nachricht and Bearbeiten (_lib/sizes.ts).
  const columns = detailColumns(canWork);

  return (
    // Bottom padding below `md` keeps the fixed bar off the last card. The
    // provider carries what is still saving (optimistic UI, _pending.tsx).
    <PendingProvider actorName={session.fullName} actorEmail={session.email}>
      <div className="pb-24 md:pb-0">
        <div className="mb-4 flex h-[var(--track-h)] items-center md:mb-6">
          <Link href="/anfragen" className={cn(QUIET_CONTROL, "-ml-2.5")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Alle Anfragen
          </Link>
        </div>

        <div className={DETAIL_GRID}>
          <div className={columns.record}>
            <div className={columns.recordTop}>
              <RecordCard
                className={cn(ORDER.record, "[--delay:20ms]")}
                requestId={request.id}
                name={name}
                phone={request.contactPhone}
                email={request.contactEmail}
                countryCode={session.currency === "CHF" ? "41" : "49"}
                status={request.status}
                pvsControlled={pvsControlled}
                canWork={canWork}
                clock={clock}
                followups={followups}
                treatment={treatment}
                // Where the person came from, as the Quellen card counts it.
                source={withBrandLogos(
                  reportingChannelLabel(
                    reportingChannel({
                      source: request.source,
                      utm: request.utm,
                    }),
                  ),
                )}
                post={postTitle}
                locationName={locationName}
                createdAt={request.createdAt}
                pvs={pvs}
              />
            </div>

            <div className={columns.recordRest}>
              {/* Wiederbehandlungen of this patient, with the way to take one off
                the calendar or back on (the old card's list, per person). */}
              {retreatments.calls.length > 0 && (
                <RetreatmentSection
                  className={cn(ORDER.retreatment, "[--delay:80ms]")}
                  data={retreatments}
                  name={name}
                  canWork={canWork}
                  isInhaber={can(session.role, "settings.team")}
                />
              )}

              {(siblings.length > 0 || (patientLtv ?? 0) > 0) && (
                <SiblingsCard
                  className={cn(ORDER.siblings, "[--delay:100ms]")}
                  siblings={siblings}
                  lifetimeRevenue={patientLtv}
                  currency={session.currency}
                />
              )}
            </div>
          </div>

          <div className={columns.work}>
            <div className={columns.workTop}>
              {/* What they told us: the message, then the answers as pairs
                (the call card's well). Plain dark text, one fixed height. */}
              <DashCard
                title="Nachricht"
                className={cn(ORDER.message, "[--delay:40ms]")}
              >
                <ScrollHint>
                  <div
                    role="region"
                    aria-label="Nachricht und Angaben"
                    tabIndex={0}
                    className={cn(
                      "scroll-shadows elev-inset rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      MESSAGE_HEIGHT,
                    )}
                  >
                    {request.message ? (
                      <p className="whitespace-pre-wrap break-words">
                        {request.message}
                      </p>
                    ) : (
                      <p className="text-fg-secondary">
                        Keine Nachricht hinterlassen.
                      </p>
                    )}
                    {pairs.length > 0 && (
                      <dl className="mt-3 space-y-1">
                        {pairs.map((p, i) => (
                          <div
                            key={`${i}-${p.label}`}
                            className={cn("grid gap-3", PAIR_COLUMNS)}
                          >
                            <dt className="text-sm leading-6 text-fg-secondary">
                              {p.label}
                            </dt>
                            <dd className="min-w-0 break-words">{p.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </ScrollHint>
              </DashCard>

              {/* The work on it: the call's result in one tap (the call card's
                switch), then note, sent message or Wiedervorlage. The status
                is changed in the record, where it is read. */}
              {canWork && (
                <DashCard
                  title="Bearbeiten"
                  className={cn(ORDER.work, "[--delay:60ms]")}
                >
                  <CallResult
                    requestId={request.id}
                    name={name}
                    status={request.status}
                    pvsControlled={pvsControlled}
                  />
                  <div className="my-5 border-t border-border" />
                  <Composer requestId={request.id} name={name} />
                </DashCard>
              )}
            </div>

            <div className={columns.workRest}>
              <DashCard
                title="Verlauf"
                className={cn(ORDER.verlauf, "[--delay:80ms]")}
              >
                <Verlauf
                  requestId={request.id}
                  name={name}
                  canWork={canWork}
                  followups={followups}
                  activities={activities.map((a) => ({
                    id: a.id,
                    kind: a.kind,
                    actorName: a.actorName,
                    actorEmail: a.actorEmail,
                    body: a.body,
                    meta: a.meta,
                    createdAt: a.createdAt,
                  }))}
                />
              </DashCard>

              <DetailsCard
                className={cn(ORDER.details, "[--delay:100ms]")}
                requestId={request.id}
                name={name}
                canWork={canWork}
                clock={clock}
                adsConsentAt={request.adsConsentAt}
                adsConsentRevokedAt={request.adsConsentRevokedAt}
                dsgvoConsentAt={request.dsgvoConsentAt}
                dsgvoConsentIp={request.dsgvoConsentIp}
                ids={{
                  request: request.id,
                  patient: request.patientId ?? null,
                  campaign: request.sourceCampaignId,
                  ad: request.sourceAdId,
                }}
                revenue={
                  request.convertedRevenueEur
                    ? Number(request.convertedRevenueEur)
                    : null
                }
                currency={session.currency}
                rawPayload={rawPayload}
              />
            </div>
          </div>
        </div>

        <MobileActionBar
          phone={request.contactPhone}
          email={request.contactEmail}
        />
      </div>
    </PendingProvider>
  );
}
