import { notFound } from "next/navigation";
import { after } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import {
  Avatar,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  StatusPill,
  Button,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  ExplainerPopover,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { responseRuleStartForClinic } from "@/server/guarantee-clock";
import { getRequestWithActivities, markRequestViewed } from "@/server/queries/requests";
import { listFollowupsForRequest } from "@/server/queries/followups";
import { leadTokenForRequestId } from "@/server/pvs-token";
import { can } from "@/lib/roles";
import { PvsTokenCard } from "./_pvs-token-card";
import { LeadCockpit, MobileActionBar } from "./_lead-cockpit";
import { AI_SCORE_EXPLANATION, aiCategoryWord, aiScoreText } from "../_lib/ai-score";
import {
  DEADLINE_RUNNING_HINT,
  LATE_HINT,
  NOT_ANSWERED_HINT,
  OVERDUE_HINT,
} from "../_lib/response-hints";
import { Followups } from "./_followups";
import { statusChangeLine } from "./_status-change";
import { RevokeAdsConsentButton } from "./_revoke-ads-consent";
import { quizAnswerLines } from "../_lib/quiz-answers";
import { germanAiReasoning } from "../_lib/ai-reasoning";
import { quizFromSignals } from "@/server/queries/requests";
import {
  siblingRequests,
  patientLifetimeRevenue,
} from "@/server/queries/patients";
import {
  SOURCE_LABELS,
  ACTIVITY_KIND_LABELS,
  SLA_HOURS,
  type ActivityKind,
  type RequestStatus,
} from "@/lib/constants";
import { withBrandLogos } from "@/app/_components/Brand";
import {
  RESPONSE_STATE_LABELS,
  isPraxisResponseFlag,
  responseInfo,
} from "@/lib/response-time";
import { formatBerlinDateTime } from "@/lib/werkstunden";
import { statusImpliesContact } from "../_lib/row-timing";
import {
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/lib/formatting";
import {
  ArrowLeft,
  Mail,
  Phone,
  MessageSquare,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Anfrage" };

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
  // Protokoll and technical raw data are owner-only (`audit.view`, C-27).
  const canAudit = can(session.role, "audit.view");

  // D-6: everything that only needs the id or the clinic starts together
  // with the main query instead of after it. All of these are clinic-scoped
  // (RLS or an explicit clinic_id filter), so a foreign id leaks nothing.
  const sidePromise = Promise.all([
    siblingRequests(session.clinicId, session.userId, id),
    canAudit
      ? db
          .select({
            id: schema.auditLog.id,
            action: schema.auditLog.action,
            actorEmail: schema.auditLog.actorEmail,
            diff: schema.auditLog.diff,
            createdAt: schema.auditLog.createdAt,
          })
          .from(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.clinicId, session.clinicId),
              eq(schema.auditLog.entityKind, "request"),
              eq(schema.auditLog.entityId, id)
            )
          )
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(20)
      : Promise.resolve([]),
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
    responseRuleStartForClinic(session.clinicId),
  ]);
  // Not awaited on the 404 path; keep a failure there from becoming an
  // unhandled rejection. The real await below still sees the error.
  sidePromise.catch(() => {});

  const data = await getRequestWithActivities(session.clinicId, session.userId, id);
  if (!data) notFound();
  const { request, activities, treatmentName, locationName, firstAttemptAt } = data;

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
    })
  );

  // Clear the sidebar "neu" badge the first time anyone opens this lead.
  // markRequestViewed is idempotent (no-op once firstViewedAt is set) and
  // best-effort; it runs after the response so the write no longer blocks
  // the render (D-6). The badge cache has a short TTL as the safety net.
  if (request.status === "neu" && request.firstViewedAt === null) {
    after(() => markRequestViewed(session.clinicId, session.userId, id));
  }

  const [[siblings, auditTrail, pvsLinkRow, followups, responseRuleStart], patientLtv] = await Promise.all([
    sidePromise,
    request.patientId
      ? patientLifetimeRevenue(session.clinicId, session.userId, request.patientId)
      : Promise.resolve(null),
  ]);
  const quizAnswers = quizAnswerLines(quizFromSignals(request.aiSignals));

  // Accountability counters for the proof summary. Cheap — reuse the
  // already-loaded `activities` array for the call count, and the
  // followups list (pending-first) for the next due Wiedervorlage.
  const callCount = activities.filter((a) => a.kind === "call").length;
  const reactionMs =
    request.firstContactedAt != null
      ? request.firstContactedAt.getTime() - request.createdAt.getTime()
      : null;
  const nextFollowup = followups.find((f) => f.status === "pending") ?? null;
  const pvsControlled = request.pvsAppointmentId !== null;

  // Direction A: only surface the EINS-Lead token while the request hasn't
  // already been linked to a PVS appointment. Once linked, the token has
  // served its purpose and is just noise.
  const showPvsToken =
    pvsLinkRow !== null &&
    pvsLinkRow.status === "connected" &&
    request.pvsAppointmentId === null;
  const pvsLeadToken = showPvsToken ? leadTokenForRequestId(id) : null;

  // 48-Werkstunden rule (Kanon 6a). Separate from the internal 3-hour SLA
  // above: this one has contractual consequences for the Praxis.
  const response = responseInfo(
    {
      createdAt: request.createdAt,
      firstAttemptAt,
      status: request.status,
      ruleStart: responseRuleStart,
    },
    new Date()
  );

  // Termin vereinbart or later without a logged attempt: the person was
  // reached anyway, so no deadline warnings (same rule as the list, rowTiming).
  const contactImplied = statusImpliesContact(request.status) && !firstAttemptAt;

  const slaBreached =
    !contactImplied &&
    !request.firstContactedAt &&
    request.slaRespondBy &&
    request.slaRespondBy.getTime() < Date.now();

  // Parse aiSignals for badge strip.
  const aiSignals =
    request.aiSignals && typeof request.aiSignals === "object"
      ? (request.aiSignals as Record<string, unknown>)
      : null;

  // KI-Bewertung, short (DS3): "74/100"; the bands are explained in the popover.
  const scoreText =
    request.aiScore != null
      ? aiScoreText(request.aiScore)
      : aiCategoryWord(request.aiCategory);
  const responseFlagged = isPraxisResponseFlag(response.state);
  const responseHint =
    response.state === "nicht_beantwortet"
      ? NOT_ANSWERED_HINT
      : response.state === "zu_spaet"
      ? LATE_HINT
      : DEADLINE_RUNNING_HINT;

  return (
    // Bottom padding below `md` keeps the fixed action bar off the last card.
    <div className="space-y-4 pb-24 md:pb-0">
      <Link
        href="/anfragen"
        className="group inline-flex items-center gap-1.5 text-sm font-medium text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden />
        Alle Anfragen
      </Link>

      {/* Kopf: wer, wie erreichbar, bis wann. Eine Karte statt mehrerer. */}
      <Card className="p-5 md:p-6">
        <div className="space-y-5">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight md:text-3xl">
              {request.contactName ?? "Unbekannt"}
            </h1>
            {/* Same order as the Anfragen list: status, then the plain facts. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-fg-secondary">
              <StatusPill status={request.status} />
              {request.statusSource === "pvs" && <span>· Status aus der PVS</span>}
            </div>
            <div className="mt-1 text-sm text-fg-secondary">
              {treatmentName && <>{treatmentName} · </>}
              {withBrandLogos(SOURCE_LABELS[request.source as keyof typeof SOURCE_LABELS] ?? request.source)}
              {locationName && <> · {locationName}</>}
            </div>
          </div>

          {/* Kontakt: Nummer und Adresse als Text, genau ein "Anrufen".
              Unter `md` liegt "Anrufen" in der festen Leiste unten. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border py-3">
            {request.contactPhone ? (
              <span className="inline-flex items-center gap-1.5 text-base font-medium text-fg-primary">
                <Phone className="h-4 w-4 shrink-0" aria-hidden />
                <span className="tabular-nums">{request.contactPhone}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-base text-fg-secondary">
                <Phone className="h-4 w-4" aria-hidden /> Keine Telefonnummer
              </span>
            )}
            {request.contactEmail ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-base text-fg-primary">
                <Mail className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{request.contactEmail}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-base text-fg-secondary">
                <Mail className="h-4 w-4" aria-hidden /> Keine E-Mail-Adresse
              </span>
            )}
            {request.treatmentWish && (
              <span className="min-w-0 text-base text-fg-primary">
                <span className="font-medium">Wunsch:</span>{" "}
                <span className="break-words">{request.treatmentWish}</span>
              </span>
            )}
            <div className="hidden flex-wrap items-center gap-2 md:ml-auto md:flex">
              {request.contactPhone && (
                <Button asChild size="sm">
                  <a href={`tel:${request.contactPhone}`}>
                    <Phone className="h-4 w-4" />
                    Anrufen
                  </a>
                </Button>
              )}
              {request.contactEmail && (
                <Button asChild size="sm" variant="outline">
                  <a href={`mailto:${request.contactEmail}`}>
                    <Mail className="h-4 w-4" />
                    E-Mail
                  </a>
                </Button>
              )}
            </div>
            {/* Phones: the bar carries Anrufen, so only E-Mail stays here. */}
            {request.contactPhone && request.contactEmail && (
              <Button asChild size="sm" variant="outline" className="md:hidden">
                <a href={`mailto:${request.contactEmail}`}>
                  <Mail className="h-4 w-4" />
                  E-Mail schreiben
                </a>
              </Button>
            )}
          </div>

          {/* Fristen: Entscheidungswerte, darum kräftig und in Worten. */}
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <TimeFact label="Eingegangen" value={formatDateTime(request.createdAt)} />
            {request.firstContactedAt && (
              <TimeFact
                label="Erstkontakt"
                value={formatDateTime(request.firstContactedAt)}
              />
            )}
            {request.slaRespondBy && (
              <TimeFact
                label={`Rückruf-Ziel (${SLA_HOURS} Stunden)`}
                value={formatDateTime(request.slaRespondBy)}
                status={slaBreached ? "Überfällig" : null}
                statusTone="bad"
                hintTerm="Rückruf-Ziel"
                hint={OVERDUE_HINT}
              />
            )}
            {response.deadline && response.state !== "ausgenommen" && !contactImplied && (
              <TimeFact
                label="48-Werkstunden-Frist"
                value={formatBerlinDateTime(response.deadline)}
                status={RESPONSE_STATE_LABELS[response.state]}
                statusTone={
                  responseFlagged ? "bad" : response.state === "rechtzeitig" ? "good" : "default"
                }
                hintTerm={responseFlagged ? RESPONSE_STATE_LABELS[response.state] : "48 Werkstunden"}
                hint={responseHint}
              />
            )}
          </dl>

          {/* Antworten aus dem Zielseiten-Quiz (C-26): der Gesprächseinstieg
              für den Rückruf, vorher nur im JSON der Rohdaten. */}
          {quizAnswers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {quizAnswers.map((a) => (
                <Badge key={a.label} tone="neutral" className="text-sm">
                  {a.label}: {a.value}
                </Badge>
              ))}
            </div>
          )}

          {/* Nachricht und KI-Bewertung nebeneinander auf breiten Schirmen */}
          {(request.message || request.aiReasoning || scoreText) && (
            <div className="grid gap-4 md:grid-cols-2">
              {request.message && (
                <div>
                  <div className="text-sm font-medium text-fg-primary">
                    Nachricht der Anfrage
                  </div>
                  <blockquote className="mt-1.5 whitespace-pre-wrap rounded-lg border-l-2 border-accent bg-bg-secondary px-3 py-2 text-base leading-relaxed text-fg-primary">
                    {request.message}
                  </blockquote>
                </div>
              )}

              {(scoreText || request.aiReasoning) && (
                <div>
                  <div className="flex items-center gap-1 text-sm font-medium text-fg-primary">
                    KI-Bewertung
                    <ExplainerPopover term="KI-Bewertung" ariaLabel="Erklärung zur KI-Bewertung">
                      {AI_SCORE_EXPLANATION}
                    </ExplainerPopover>
                  </div>
                  {scoreText && (
                    <p className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">
                      {scoreText}
                    </p>
                  )}
                  {request.aiReasoning && (
                    <p className="mt-1 text-sm leading-relaxed text-fg-primary">
                      {germanAiReasoning(request.aiReasoning)}
                    </p>
                  )}
                  {request.aiPromptVersion === "rules-v3-llm-notes" && (
                    <p className="mt-1 text-sm text-fg-secondary">
                      Notizen-Bewertung KI-generiert · finale Qualifizierung durch das Praxis-Team
                    </p>
                  )}
                  {aiSignals && signalLine(aiSignals) && (
                    <p className="mt-2 text-sm text-fg-secondary">{signalLine(aiSignals)}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Consent to report to Meta/Google (migration 0077). Without an
              active consent the purchase workers never report this person. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-primary">
            <span>
              Einwilligung Meta/Google:{" "}
              {request.adsConsentRevokedAt
                ? `widerrufen am ${formatDate(request.adsConsentRevokedAt)}`
                : request.adsConsentAt
                ? `erteilt am ${formatDate(request.adsConsentAt)}`
                : "nicht erteilt"}
            </span>
            {canWork && request.adsConsentAt && !request.adsConsentRevokedAt && (
              <RevokeAdsConsentButton requestId={request.id} />
            )}
          </div>
        </div>
      </Card>

      {/* Telefon ohne Bearbeitungsrecht: nur "Anrufen" in der Leiste unten.
          Mit Recht rendert das Cockpit die Leiste samt "Protokollieren". */}
      {!canWork && (
        <MobileActionBar
          contactPhone={request.contactPhone}
          contactEmail={request.contactEmail}
        />
      )}

      {/* Lead-Cockpit: Reaktions-Nachweis + Arbeitsfläche. Die
          Vor-Buchungs-Phase ist portal-nativ; sobald die Anfrage an einen
          PVS-Termin gekoppelt ist, sperrt die Status-Steuerung (PVS gewinnt;
          siehe _lead-cockpit.tsx + actions.ts). Anrufe, Notizen und
          Wiedervorlagen bleiben immer erlaubt. Der Status steht oben im Kopf. */}
      {canWork && (
        <Card className="p-5 md:p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <ProofStat
              label="Reaktionszeit"
              value={reactionMs != null ? formatDuration(reactionMs) : "Noch kein Kontakt"}
            />
            <ProofStat
              label="Anrufversuche"
              value={callCount === 0 ? "Noch keine" : String(callCount)}
            />
            <ProofStat
              label="Nächste Wiedervorlage"
              value={nextFollowup ? formatDateTime(nextFollowup.dueAt) : "Keine"}
            />
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-3 text-sm text-fg-primary">
              Jeder protokollierte Anruf, jede vermerkte E-Mail oder
              WhatsApp-Nachricht und der Status „Kontaktiert“, „Nicht
              erreicht“ oder „Termin vereinbart“ zählen als Kontaktversuch.
            </p>
            <LeadCockpit
              requestId={request.id}
              currentStatus={request.status}
              pvsControlled={pvsControlled}
              contactPhone={request.contactPhone}
              contactEmail={request.contactEmail}
            />
          </div>
        </Card>
      )}

      {/* Wiedervorlagen vor dem Verlauf: sie sind der nächste Schritt. Die
          Karte steht immer da, auch leer, damit man die Funktion kennt. */}
      {canWork && <Followups requestId={request.id} followups={followups} />}

      {pvsLeadToken && (
        <PvsTokenCard token={pvsLeadToken} pvsVendor={pvsLinkRow?.vendor ?? null} />
      )}

      {/* Verlauf: Aktivitäts-Protokoll. Anrufe, Notizen und Status-Wechsel
          der Vor-Buchungs-Phase werden hier portal-nativ erfasst; PVS-Events
          (Termin, Behandlung, no-show) laufen weiterhin automatisch ein. */}
      <Card className="p-5 md:p-6">
        <CardHeader className="mb-3">
          <CardTitle>Verlauf</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {activities.length === 0 ? (
            <p className="text-sm text-fg-primary">
              Noch kein Verlauf. Protokollieren Sie den ersten Anruf oder
              hinterlassen Sie eine Notiz.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {activities.map((a, idx) => {
                const prev = activities[idx + 1];
                const gapMs = prev
                  ? a.createdAt.getTime() - prev.createdAt.getTime()
                  : null;
                const statusLine =
                  a.kind === "status_change" ? statusChangeLine(a.meta) : null;
                return (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-primary">
                      <ActivityIcon kind={a.kind as ActivityKind} />
                      <span className="font-medium">
                        {ACTIVITY_KIND_LABELS[a.kind as ActivityKind] ?? a.kind}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{formatDateTime(a.createdAt)}</span>
                      {(a.actorName || a.actorEmail) && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                            <Avatar
                              src={a.actorAvatarUrl ?? null}
                              name={a.actorName ?? a.actorEmail ?? "?"}
                              size="xs"
                            />
                            {a.actorName ?? a.actorEmail}
                          </span>
                        </>
                      )}
                      {gapMs != null && gapMs > 0 && (
                        <span className="text-fg-secondary md:ml-auto">
                          +{formatDuration(gapMs)} nach vorigem Eintrag
                        </span>
                      )}
                    </div>
                    {statusLine && (
                      <p className="mt-1 text-base text-fg-primary">{statusLine}</p>
                    )}
                    {a.body && (
                      <p className="mt-1 whitespace-pre-wrap text-base text-fg-primary">
                        {a.kind === "ai_rescore" ? germanAiReasoning(a.body) : a.body}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

          {/* Sibling requests + Patient LTV */}
          {(siblings.length > 0 || patientLtv != null) && (
            <Card className="p-5 md:p-6">
              <CardHeader className="mb-3">
                <CardTitle>Patienten-Historie</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {patientLtv != null && (
                  <div>
                    <div className="text-sm font-medium text-fg-primary">
                      Gesamtumsatz dieses Patienten
                    </div>
                    <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
                      {formatMoney(patientLtv, session.currency)}
                    </div>
                  </div>
                )}
                {siblings.length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-medium text-fg-primary">
                      Andere Anfragen dieses Patienten
                    </div>
                    {/* Fixed columns: status, date and amount line up row by row. */}
                    <ul className="divide-y divide-border">
                      {siblings.map((s) => (
                        <li
                          key={s.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_10rem_6rem_6.5rem]"
                        >
                          <Link
                            href={`/anfragen/${s.id}`}
                            className="truncate font-medium text-fg-primary hover:text-accent"
                          >
                            {s.treatmentWish ?? "Anfrage"}
                          </Link>
                          <span className="justify-self-end sm:justify-self-start">
                            <StatusPill status={s.status as RequestStatus} />
                          </span>
                          <span className="tabular-nums text-fg-secondary sm:text-right">
                            {formatDate(s.createdAt)}
                          </span>
                          <span className="text-right font-medium tabular-nums text-fg-primary">
                            {s.convertedRevenueEur != null
                              ? formatMoney(s.convertedRevenueEur, session.currency)
                              : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Technical metadata + UTM + raw payload + audit — all collapsible */}
          <Accordion type="multiple">
            <AccordionItem value="tech">
              <AccordionTrigger>Technische Details</AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <DataField label="Anfrage-ID" value={request.id} />
                  <DataField label="Kampagnen-ID" value={request.sourceCampaignId} />
                  <DataField label="Anzeigen-ID" value={request.sourceAdId} />
                  <DataField label="Budget-Angabe" value={request.budgetIndication} />
                  <DataField
                    label="Umsatz"
                    value={
                      request.convertedRevenueEur
                        ? formatMoney(Number(request.convertedRevenueEur), session.currency)
                        : null
                    }
                  />
                  <DataField
                    label="DSGVO-Zustimmung"
                    value={
                      request.dsgvoConsentAt
                        ? formatDateTime(request.dsgvoConsentAt)
                        : "Keine (Anruf, Buchung oder Eintrag am Empfang)"
                    }
                  />
                  <DataField
                    label="DSGVO IP (gekürzt)"
                    value={maskIp(request.dsgvoConsentIp)}
                  />
                  <DataField
                    label="KI-Version"
                    value={request.aiPromptVersion}
                  />
                  <DataField label="Patient-ID" value={request.patientId ?? null} />
                </div>
              </AccordionContent>
            </AccordionItem>
            {!!request.utm &&
              typeof request.utm === "object" &&
              Object.keys(request.utm as Record<string, unknown>).length > 0 && (
                <AccordionItem value="utm">
                  <AccordionTrigger>UTM-Parameter</AccordionTrigger>
                  <AccordionContent>
                    <KvTable kv={request.utm as Record<string, unknown>} />
                  </AccordionContent>
                </AccordionItem>
              )}
            {canAudit &&
              !!request.rawPayload &&
              typeof request.rawPayload === "object" &&
              Object.keys(request.rawPayload as Record<string, unknown>).length > 0 && (
                <AccordionItem value="raw">
                  <AccordionTrigger>Übermittelte Formulardaten</AccordionTrigger>
                  <AccordionContent>
                    <pre className="overflow-x-auto rounded-md border border-border bg-bg-secondary p-4 text-xs">
                      {JSON.stringify(request.rawPayload, null, 2)}
                    </pre>
                  </AccordionContent>
                </AccordionItem>
              )}
            {auditTrail.length > 0 && (
              <AccordionItem value="audit">
                <AccordionTrigger>Protokoll</AccordionTrigger>
                <AccordionContent>
                  <ul className="divide-y divide-border text-sm">
                    {auditTrail.map((a) => (
                      <li key={a.id} className="py-2">
                        <div className="flex items-center justify-between text-sm text-fg-secondary">
                          <span className="font-medium text-fg-primary">
                            {a.action}
                          </span>
                          <span className="tabular-nums">
                            {formatDateTime(a.createdAt)}
                          </span>
                        </div>
                        <div className="text-fg-primary">
                          {a.actorEmail ?? "–"}
                        </div>
                        {!!a.diff && (
                          <pre className="mt-1 overflow-x-auto rounded bg-bg-secondary p-2 text-xs">
                            {JSON.stringify(a.diff, null, 2)}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
    </div>
  );
}

/**
 * A time that drives a decision (DS3 item 3): label, the time in weight,
 * and the state in words (never colour alone), with an optional (i).
 */
function TimeFact({
  label,
  value,
  status = null,
  statusTone = "default",
  hint,
  hintTerm,
}: {
  label: string;
  value: string;
  status?: string | null;
  statusTone?: "default" | "good" | "bad";
  hint?: string;
  hintTerm?: string;
}) {
  // Same pattern as the timing line in the lists: icon first, dark text.
  const Icon = statusTone === "bad" ? AlertTriangle : statusTone === "good" ? CheckCircle2 : Clock;
  const iconClass =
    statusTone === "bad" ? "text-tone-bad" : statusTone === "good" ? "text-tone-good" : "text-fg-secondary";
  return (
    <div className="min-w-0">
      <dt className="flex items-center text-sm font-medium text-fg-primary">
        {label}
        {hint && (
          <ExplainerPopover term={hintTerm ?? label} ariaLabel={`Erklärung zu ${hintTerm ?? label}`}>
            {hint}
          </ExplainerPopover>
        )}
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-fg-primary">{value}</dd>
      {status && (
        <dd className="flex items-start gap-1.5 text-sm font-medium text-fg-primary">
          <Icon aria-hidden className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${iconClass}`} />
          {status}
        </dd>
      )}
    </div>
  );
}

/** Label over value, the same anatomy as TimeFact. Urgency lives in the
 *  Rückruf-Ziel line above, so the value stays in the normal text colour. */
function ProofStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-fg-primary">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-fg-primary">{value}</div>
    </div>
  );
}

function DataField({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
  href?: string;
}) {
  const content = value ?? <span className="text-fg-secondary">–</span>;
  return (
    <div>
      <div className="text-sm font-medium text-fg-primary">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2 text-base text-fg-primary">
        {icon}
        {href ? (
          <a href={href} className="underline underline-offset-4 hover:text-accent">
            {content}
          </a>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  switch (kind) {
    case "call":
      return <Phone className="h-3.5 w-3.5" />;
    case "email":
      return <Mail className="h-3.5 w-3.5" />;
    case "whatsapp":
    case "note":
      return <MessageSquare className="h-3.5 w-3.5" />;
    case "status_change":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    default:
      return <Clock className="h-3.5 w-3.5" />;
  }
}

/**
 * The scorer's inputs as one grey line ("Kontaktdaten vollständig: Ja ·
 * Textlänge: 69"). Plain facts, so no coloured dots. Nested objects (the raw
 * `quiz` payload that produced the other signals) and empty values are left out.
 */
function signalLine(signals: Record<string, unknown>): string | null {
  const parts = Object.entries(signals)
    .filter(([, v]) => v != null && typeof v !== "object")
    .map(([k, v]) => {
      const label = SIGNAL_LABELS[k] ?? k;
      const display = typeof v === "boolean" ? (v ? "Ja" : "Nein") : String(v);
      return `${label}: ${display}`;
    });
  return parts.length > 0 ? parts.join(" · ") : null;
}

const SIGNAL_LABELS: Record<string, string> = {
  budgetMentioned: "Budget genannt",
  treatmentSpecified: "Behandlung konkret",
  contactComplete: "Kontaktdaten vollständig",
  hasUrgency: "Dringlichkeit",
  messageLength: "Textlänge",
};

function KvTable({ kv }: { kv: Record<string, unknown> }) {
  const entries = Object.entries(kv);
  if (entries.length === 0)
    return <p className="text-sm text-fg-secondary">Keine Werte.</p>;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="px-3 py-1.5 text-sm font-medium text-fg-primary">
              {k}
            </td>
            <td className="px-3 py-1.5 tabular-nums text-fg-primary">
              {v == null ? "–" : String(v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Shortened consent IP (C-27): last IPv4 octet zeroed, IPv6 cut to the
 * first three groups. Enough to show that consent came from a real request,
 * not enough to identify the device.
 */
function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (v4) return `${v4[1]}.0`;
  if (ip.includes(":")) {
    return `${ip.split(":").slice(0, 3).join(":")}::`;
  }
  return null;
}

function formatDuration(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${Math.round(min)} Min`;
  const hr = min / 60;
  if (hr < 48) return `${hr.toFixed(1).replace(".", ",")} Std`;
  const days = hr / 24;
  return `${Math.round(days)} Tage`;
}
