import { notFound } from "next/navigation";
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
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { getRequestWithActivities, markRequestViewed } from "@/server/queries/requests";
import { leadTokenForRequestId } from "@/server/pvs-token";
import { PvsTokenCard } from "./_pvs-token-card";
import {
  siblingRequests,
  patientLifetimeRevenue,
} from "@/server/queries/patients";
import {
  SOURCE_LABELS,
  ACTIVITY_KIND_LABELS,
  AI_CATEGORY_LABELS,
  type ActivityKind,
  type RequestStatus,
} from "@/lib/constants";
import { withBrandLogos } from "@/app/_components/Brand";
import {
  formatDate,
  formatDateTime,
  formatEuro,
} from "@/lib/formatting";
import {
  ArrowLeft,
  Mail,
  Phone,
  MessageSquare,
  CheckCircle2,
  Clock,
  Sparkles,
} from "lucide-react";

export const metadata = { title: "Anfrage" };

export default async function AnfrageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const data = await getRequestWithActivities(session.clinicId, session.userId, id);
  if (!data) notFound();
  const { request, activities, treatmentName, locationName } = data;

  // Clear the sidebar "neu" badge the first time anyone opens this lead.
  // markRequestViewed is idempotent (no-op once firstViewedAt is set) and
  // best-effort. The (portal) layout is dynamic, so the badge re-counts
  // automatically on the next navigation — no revalidate needed.
  if (request.status === "neu" && request.firstViewedAt === null) {
    await markRequestViewed(session.clinicId, session.userId, id);
  }

  const [siblings, patientLtv, auditTrail, pvsLinkRow] = await Promise.all([
    siblingRequests(session.clinicId, session.userId, id),
    request.patientId
      ? patientLifetimeRevenue(session.clinicId, session.userId, request.patientId)
      : Promise.resolve(null),
    db
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
          eq(schema.auditLog.entityId, id),
          eq(schema.auditLog.entityKind, "request")
        )
      )
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(20),
    db
      .select({
        vendor: schema.pvsLink.pvsVendor,
        status: schema.pvsLink.status,
      })
      .from(schema.pvsLink)
      .where(eq(schema.pvsLink.clinicId, session.clinicId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  // Direction A: only surface the EINS-Lead token while the request hasn't
  // already been linked to a PVS appointment. Once linked, the token has
  // served its purpose and is just noise.
  const showPvsToken =
    pvsLinkRow !== null &&
    pvsLinkRow.status === "connected" &&
    request.pvsAppointmentId === null;
  const pvsLeadToken = showPvsToken ? leadTokenForRequestId(id) : null;

  const slaBreached =
    !request.firstContactedAt &&
    request.slaRespondBy &&
    request.slaRespondBy.getTime() < Date.now();

  // Parse aiSignals for badge strip.
  const aiSignals =
    request.aiSignals && typeof request.aiSignals === "object"
      ? (request.aiSignals as Record<string, unknown>)
      : null;

  const scoreTone =
    request.aiCategory === "hot"
      ? "bg-accent/15 text-accent ring-accent/20"
      : request.aiCategory === "warm"
      ? "bg-tone-warn/15 text-tone-warn ring-tone-warn/20"
      : "bg-bg-secondary text-fg-secondary ring-border";

  return (
    <div className="space-y-4">
      <Button
        asChild
        variant="outline"
        size="lg"
        className="group gap-2 border-border bg-bg-secondary/60 px-4 font-semibold text-fg-primary shadow-sm hover:bg-bg-secondary hover:text-fg-primary"
      >
        <Link href="/anfragen">
          <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
          Zurück zur Anfragen-Übersicht
        </Link>
      </Button>

      {/* Lead header — compact */}
      <Card className="p-5 md:p-6">
        <div className="space-y-4">
          {/* Title row: name + badges | dates + score chip */}
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold leading-tight md:text-3xl">
                {request.contactName ?? "Unbekannt"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusPill status={request.status} />
                {request.aiCategory && (
                  <Badge
                    tone={
                      request.aiCategory === "hot"
                        ? "accent"
                        : request.aiCategory === "warm"
                        ? "warn"
                        : "neutral"
                    }
                  >
                    {AI_CATEGORY_LABELS[request.aiCategory as keyof typeof AI_CATEGORY_LABELS]}
                  </Badge>
                )}
                <Badge tone="neutral">
                  {withBrandLogos(SOURCE_LABELS[request.source as keyof typeof SOURCE_LABELS] ?? request.source)}
                </Badge>
                {treatmentName && <Badge tone="accent">{treatmentName}</Badge>}
                {locationName && <Badge tone="neutral">{locationName}</Badge>}
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5 text-right text-xs text-fg-secondary">
              {request.aiScore != null && (
                <div
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ${scoreTone}`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="tabular-nums">
                    {request.aiScore}
                    <span className="font-normal opacity-60">/100</span>
                  </span>
                </div>
              )}
              <div className="tabular-nums">Eingegangen: {formatDateTime(request.createdAt)}</div>
              {request.slaRespondBy && (
                <div className={`tabular-nums ${slaBreached ? "text-tone-bad" : ""}`}>
                  Frist: {formatDateTime(request.slaRespondBy)}
                  {slaBreached && " (überschritten)"}
                </div>
              )}
              {request.firstContactedAt && (
                <div className="tabular-nums text-tone-good">
                  Erstkontakt: {formatDateTime(request.firstContactedAt)}
                </div>
              )}
            </div>
          </div>

          {/* Contact strip with inline quick actions */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg-secondary/40 px-4 py-2.5">
            {request.contactEmail ? (
              <a
                href={`mailto:${request.contactEmail}`}
                className="inline-flex min-w-0 items-center gap-1.5 text-sm text-fg-primary hover:text-accent"
              >
                <Mail className="h-4 w-4 shrink-0 text-fg-secondary" />
                <span className="truncate">{request.contactEmail}</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-fg-tertiary">
                <Mail className="h-4 w-4" /> –
              </span>
            )}
            {request.contactPhone ? (
              <a
                href={`tel:${request.contactPhone}`}
                className="inline-flex items-center gap-1.5 text-sm text-fg-primary hover:text-accent"
              >
                <Phone className="h-4 w-4 shrink-0 text-fg-secondary" />
                <span className="tabular-nums">{request.contactPhone}</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-fg-tertiary">
                <Phone className="h-4 w-4" /> –
              </span>
            )}
            {request.treatmentWish && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-fg-primary">
                <Sparkles className="h-4 w-4 shrink-0 text-fg-secondary" />
                <span className="truncate">{request.treatmentWish}</span>
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
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
          </div>

          {/* Message + AI reasoning side-by-side on wider screens */}
          {(request.message || request.aiReasoning) && (
            <div className="grid gap-3 md:grid-cols-2">
              {request.message && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                    Nachricht der Anfrage
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-bg-secondary p-3 text-sm leading-relaxed text-fg-primary">
                    {request.message}
                  </p>
                </div>
              )}

              {request.aiReasoning && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                    KI-Einschätzung
                  </div>
                  <p className="mt-1.5 rounded-lg bg-bg-secondary/40 p-3 text-sm italic leading-relaxed text-fg-primary">
                    {request.aiReasoning}
                  </p>
                  {request.aiPromptVersion === "rules-v3-llm-notes" && (
                    <p className="mt-1 text-[11px] text-fg-tertiary">
                      Notizen-Bewertung KI-generiert · finale Qualifizierung durch das Praxis-Team
                    </p>
                  )}
                  {aiSignals && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(aiSignals)
                        // Skip nested objects (e.g. `quiz` is the raw form
                        // payload that *produced* the other signals, not a
                        // signal itself — rendering it as a chip yielded
                        // "quiz: [object Object]").
                        .filter(([, v]) => typeof v !== "object" || v === null)
                        .map(([k, v]) => (
                          <SignalBadge key={k} signal={k} value={v} />
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {pvsLeadToken && (
        <PvsTokenCard token={pvsLeadToken} pvsVendor={pvsLinkRow?.vendor ?? null} />
      )}

      {/* Verlauf — read-only activity log. Status, calls, notes, Folgetermine
          and assignment are all owned upstream (PVS / phone system); the
          portal listens and renders. */}
      <div className="grid gap-4">
        <div>
          <Card className="p-5 md:p-6">
            <CardHeader className="mb-3">
              <CardTitle className="text-base">Verlauf</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              {activities.length === 0 ? (
                <p className="py-4 text-sm text-fg-secondary">
                  Noch kein Verlauf. Aktivitäten erscheinen automatisch hier,
                  sobald sie aus der PVS oder anderen verbundenen Systemen
                  übernommen werden.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {activities.map((a, idx) => {
                    const prev = activities[idx + 1];
                    const gapMs = prev
                      ? a.createdAt.getTime() - prev.createdAt.getTime()
                      : null;
                    return (
                      <li key={a.id} className="py-3">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-secondary">
                          <ActivityIcon kind={a.kind as ActivityKind} />
                          <span>
                            {ACTIVITY_KIND_LABELS[a.kind as ActivityKind] ?? a.kind}
                          </span>
                          <span>·</span>
                          <Clock className="h-3 w-3" />
                          <span>{formatDateTime(a.createdAt)}</span>
                          {(a.actorName || a.actorEmail) && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-fg-tertiary">
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
                            <span className="ml-auto text-fg-tertiary normal-case tracking-normal">
                              +{formatDuration(gapMs)} nach vorigem Eintrag
                            </span>
                          )}
                        </div>
                        {a.body && (
                          <p className="mt-1 whitespace-pre-wrap text-base text-fg-primary">
                            {a.body}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

      </div>

          {/* Sibling requests + Patient LTV */}
          {(siblings.length > 0 || patientLtv != null) && (
            <Card className="p-5 md:p-6">
              <CardHeader className="mb-3">
                <CardTitle className="text-base">Patienten-Historie</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {patientLtv != null && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                      Lifetime-Wert dieses Patienten
                    </div>
                    <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
                      {formatEuro(patientLtv)}
                    </div>
                  </div>
                )}
                {siblings.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                      Andere Anfragen dieses Patienten
                    </div>
                    <ul className="divide-y divide-border">
                      {siblings.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center justify-between py-2 text-sm"
                        >
                          <Link
                            href={`/anfragen/${s.id}`}
                            className="font-medium text-fg-primary hover:text-accent"
                          >
                            {s.treatmentWish ?? "Anfrage"}
                          </Link>
                          <div className="flex items-center gap-3 text-xs">
                            <StatusPill status={s.status as RequestStatus} />
                            <span className="text-fg-tertiary tabular-nums">
                              {formatDate(s.createdAt)}
                            </span>
                            {s.convertedRevenueEur != null && (
                              <span className="text-tone-good tabular-nums">
                                {formatEuro(s.convertedRevenueEur)}
                              </span>
                            )}
                          </div>
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
                        ? formatEuro(Number(request.convertedRevenueEur))
                        : null
                    }
                  />
                  <DataField
                    label="DSGVO-Zustimmung"
                    value={formatDateTime(request.dsgvoConsentAt)}
                  />
                  <DataField
                    label="DSGVO IP"
                    value={request.dsgvoConsentIp ?? null}
                  />
                  <DataField
                    label="AI-Prompt"
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
            {!!request.rawPayload &&
              typeof request.rawPayload === "object" &&
              Object.keys(request.rawPayload as Record<string, unknown>).length > 0 && (
                <AccordionItem value="raw">
                  <AccordionTrigger>Rohdaten</AccordionTrigger>
                  <AccordionContent>
                    <pre className="overflow-x-auto rounded-md border border-border bg-bg-secondary/40 p-4 text-xs">
                      {JSON.stringify(request.rawPayload, null, 2)}
                    </pre>
                  </AccordionContent>
                </AccordionItem>
              )}
            {auditTrail.length > 0 && (
              <AccordionItem value="audit">
                <AccordionTrigger>Audit-Trail</AccordionTrigger>
                <AccordionContent>
                  <ul className="divide-y divide-border text-sm">
                    {auditTrail.map((a) => (
                      <li key={a.id} className="py-2">
                        <div className="flex items-center justify-between text-xs text-fg-secondary">
                          <span className="font-medium uppercase tracking-wide">
                            {a.action}
                          </span>
                          <span className="tabular-nums">
                            {formatDateTime(a.createdAt)}
                          </span>
                        </div>
                        <div className="text-fg-primary">
                          {a.actorEmail ?? "—"}
                        </div>
                        {!!a.diff && (
                          <pre className="mt-1 overflow-x-auto rounded bg-bg-secondary/40 p-2 text-xs">
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
  const content = value ?? <span className="text-fg-tertiary">–</span>;
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
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

function SignalBadge({ signal, value }: { signal: string; value: unknown }) {
  const label = SIGNAL_LABELS[signal] ?? signal;
  let display: string = "";
  let tone: "good" | "warn" | "neutral" = "neutral";
  if (typeof value === "boolean") {
    display = value ? "Ja" : "Nein";
    tone = value ? "good" : "neutral";
  } else if (typeof value === "number") {
    display = value.toString();
    tone = value > 0 ? "good" : "neutral";
  } else if (value == null) {
    display = "—";
  } else {
    display = String(value);
  }
  return (
    <Badge tone={tone}>
      <span className="inline-flex items-center gap-1">
        <Sparkles className="h-3 w-3" />
        {label}: {display}
      </span>
    </Badge>
  );
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
            <td className="px-3 py-1.5 text-xs uppercase tracking-wide text-fg-secondary">
              {k}
            </td>
            <td className="px-3 py-1.5 tabular-nums text-fg-primary">
              {v == null ? "—" : String(v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatDuration(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${Math.round(min)} Min`;
  const hr = min / 60;
  if (hr < 48) return `${hr.toFixed(1).replace(".", ",")} Std`;
  const days = hr / 24;
  return `${Math.round(days)} Tage`;
}
