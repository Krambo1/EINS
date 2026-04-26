import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  StatusPill,
  Button,
  Separator,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { getRequestWithActivities } from "@/server/queries/requests";
import { listTreatments } from "@/server/queries/treatments";
import {
  recallsForRequest,
  siblingRequests,
  patientLifetimeRevenue,
} from "@/server/queries/patients";
import {
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  STATUS_TRANSITIONS,
  ACTIVITY_KIND_LABELS,
  AI_CATEGORY_LABELS,
  type ActivityKind,
  type RequestStatus,
} from "@/lib/constants";
import {
  formatDate,
  formatDateTime,
  formatEuro,
  formatRelative,
} from "@/lib/formatting";
import {
  addNoteAction,
  assignAction,
  changeStatusAction,
  logCallAction,
  setTreatmentAction,
  scheduleRecallAction,
} from "./actions";
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
  const isDetail = session.uiMode === "detail";

  const data = await getRequestWithActivities(session.clinicId, session.userId, id);
  if (!data) notFound();
  const { request, activities, treatmentName, locationName } = data;

  // Detail-only data fetched lazily.
  const [team, treatments, siblings, recalls, patientLtv, auditTrail] = await Promise.all([
    db
      .select({
        id: schema.clinicUsers.id,
        fullName: schema.clinicUsers.fullName,
        email: schema.clinicUsers.email,
        role: schema.clinicUsers.role,
      })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, session.clinicId),
          isNull(schema.clinicUsers.archivedAt)
        )
      ),
    isDetail
      ? listTreatments(session.clinicId, session.userId)
      : Promise.resolve([] as Awaited<ReturnType<typeof listTreatments>>),
    isDetail
      ? siblingRequests(session.clinicId, session.userId, id)
      : Promise.resolve([] as Awaited<ReturnType<typeof siblingRequests>>),
    isDetail
      ? recallsForRequest(session.clinicId, session.userId, id)
      : Promise.resolve([] as Awaited<ReturnType<typeof recallsForRequest>>),
    isDetail && request.patientId
      ? patientLifetimeRevenue(session.clinicId, session.userId, request.patientId)
      : Promise.resolve(null),
    isDetail
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
              eq(schema.auditLog.entityId, id),
              eq(schema.auditLog.entityKind, "request")
            )
          )
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(20)
      : Promise.resolve([] as never[]),
  ]);

  const slaBreached =
    !request.firstContactedAt &&
    request.slaRespondBy &&
    request.slaRespondBy.getTime() < Date.now();

  const nextStatuses = STATUS_TRANSITIONS[request.status as RequestStatus];

  // Parse aiSignals for badge strip in detail mode.
  const aiSignals =
    request.aiSignals && typeof request.aiSignals === "object"
      ? (request.aiSignals as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/anfragen">
            <ArrowLeft className="h-4 w-4" />
            Zurück zur Übersicht
          </Link>
        </Button>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="space-y-6 p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold md:text-4xl">
                {request.contactName ?? "Unbekannt"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
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
                    {request.aiScore != null ? ` · Score ${request.aiScore}` : ""}
                  </Badge>
                )}
                <Badge tone="neutral">
                  {SOURCE_LABELS[request.source as keyof typeof SOURCE_LABELS] ?? request.source}
                </Badge>
                {treatmentName && <Badge tone="accent">{treatmentName}</Badge>}
                {locationName && <Badge tone="neutral">{locationName}</Badge>}
              </div>
            </div>

            <div className="text-right text-sm text-fg-secondary">
              <div>Eingegangen: {formatDateTime(request.createdAt)}</div>
              {request.slaRespondBy && (
                <div className={slaBreached ? "text-tone-bad" : ""}>
                  Antwort-Frist: {formatDateTime(request.slaRespondBy)}
                  {slaBreached && " (überschritten)"}
                </div>
              )}
              {request.firstContactedAt && (
                <div className="text-tone-good">
                  Erstkontakt: {formatDateTime(request.firstContactedAt)}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <DataField
              label="E-Mail"
              value={request.contactEmail}
              icon={<Mail className="h-4 w-4" />}
              href={request.contactEmail ? `mailto:${request.contactEmail}` : undefined}
            />
            <DataField
              label="Telefon"
              value={request.contactPhone}
              icon={<Phone className="h-4 w-4" />}
              href={request.contactPhone ? `tel:${request.contactPhone}` : undefined}
            />
            <DataField label="Wunschbehandlung" value={request.treatmentWish} />
          </div>

          {request.message && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Nachricht der Anfrage
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-bg-secondary p-4 text-base leading-relaxed text-fg-primary">
                {request.message}
              </p>
            </div>
          )}

          {request.aiReasoning && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                KI-Einschätzung
              </div>
              <p className="mt-2 text-base italic text-fg-primary">{request.aiReasoning}</p>

              {isDetail && aiSignals && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(aiSignals).map(([k, v]) => (
                    <SignalBadge key={k} signal={k} value={v} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions grid */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Schnellkontakt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {request.contactPhone && (
              <Button asChild className="w-full justify-center" size="lg">
                <a href={`tel:${request.contactPhone}`}>
                  <Phone className="h-5 w-5" />
                  Jetzt anrufen
                </a>
              </Button>
            )}
            {request.contactEmail && (
              <Button asChild variant="outline" className="w-full justify-center" size="lg">
                <a href={`mailto:${request.contactEmail}`}>
                  <Mail className="h-5 w-5" />
                  E-Mail schreiben
                </a>
              </Button>
            )}
            <form action={logCallAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <Button type="submit" variant="outline" className="w-full justify-center">
                <CheckCircle2 className="h-4 w-4" />
                Anruf protokollieren
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status ändern</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={changeStatusAction} className="space-y-3">
              <input type="hidden" name="requestId" value={request.id} />
              <label className="block text-sm font-medium">Neuer Status</label>
              <select
                name="status"
                className="h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
                defaultValue={nextStatuses[0] ?? request.status}
              >
                {nextStatuses.map((s) => (
                  <option key={s} value={s}>
                    {REQUEST_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <label className="block text-sm font-medium">Umsatz (nur bei Gewonnen)</label>
              <input
                name="revenue"
                inputMode="decimal"
                placeholder="z. B. 2500"
                className="h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
              />
              <Button type="submit" className="w-full">
                Speichern
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Zuständig</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={assignAction} className="space-y-3">
              <input type="hidden" name="requestId" value={request.id} />
              <select
                name="assigneeId"
                defaultValue={request.assignedTo ?? ""}
                className="h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
              >
                <option value="">— Niemand —</option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName ?? u.email}
                  </option>
                ))}
              </select>
              <Button type="submit" className="w-full" variant="outline">
                Zuweisen
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Activities + note form */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Verlauf</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              {activities.length === 0 ? (
                <p className="py-4 text-sm text-fg-secondary">
                  Noch kein Verlauf. Fügen Sie oben eine Notiz oder einen Anruf hinzu.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {activities.map((a, idx) => {
                    const prev = activities[idx + 1];
                    const gapMs = prev
                      ? a.createdAt.getTime() - prev.createdAt.getTime()
                      : null;
                    return (
                      <li key={a.id} className="py-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-secondary">
                          <ActivityIcon kind={a.kind as ActivityKind} />
                          <span>
                            {ACTIVITY_KIND_LABELS[a.kind as ActivityKind] ?? a.kind}
                          </span>
                          <span>·</span>
                          <Clock className="h-3 w-3" />
                          <span>
                            {isDetail
                              ? formatDateTime(a.createdAt)
                              : formatRelative(a.createdAt)}
                          </span>
                          {isDetail && a.actorName && (
                            <>
                              <span>·</span>
                              <span className="normal-case tracking-normal text-fg-tertiary">
                                {a.actorName}
                              </span>
                            </>
                          )}
                          {isDetail && gapMs != null && gapMs > 0 && (
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

        <Card>
          <CardHeader>
            <CardTitle>Notiz hinzufügen</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addNoteAction} className="space-y-3">
              <input type="hidden" name="requestId" value={request.id} />
              <textarea
                name="body"
                required
                rows={5}
                className="w-full rounded-xl border border-border bg-bg-primary p-3 text-base"
                placeholder="Was wurde besprochen? Was ist der nächste Schritt?"
              />
              <Button type="submit" className="w-full">
                <MessageSquare className="h-4 w-4" />
                Notiz speichern
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* ----------- DETAIL MODE -------------- */}
      {isDetail && (
        <>
          <Separator />

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Behandlungs-Kategorie</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={setTreatmentAction} className="space-y-3">
                  <input type="hidden" name="requestId" value={request.id} />
                  <select
                    name="treatmentId"
                    defaultValue={request.treatmentId ?? ""}
                    className="h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
                  >
                    <option value="">— Nicht zugeordnet —</option>
                    {treatments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" className="w-full" variant="outline">
                    Speichern
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recall planen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form action={scheduleRecallAction} className="space-y-3">
                  <input type="hidden" name="requestId" value={request.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                        Datum
                      </label>
                      <input
                        name="scheduledFor"
                        type="date"
                        required
                        className="mt-1 h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                        Art
                      </label>
                      <select
                        name="kind"
                        defaultValue="recall"
                        className="mt-1 h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
                      >
                        <option value="recall">Recall</option>
                        <option value="followup">Followup</option>
                        <option value="review_request">Bewertung</option>
                      </select>
                    </div>
                  </div>
                  <input
                    name="note"
                    placeholder="Optional: Notiz zum Anruf"
                    className="h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
                  />
                  <Button type="submit" variant="outline" className="w-full">
                    Recall hinzufügen
                  </Button>
                </form>

                {recalls.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {recalls.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between rounded-md border border-border bg-bg-secondary/40 px-3 py-1.5"
                      >
                        <span>
                          {recallKindLabel(r.kind)} ·{" "}
                          <span className="text-fg-secondary tabular-nums">
                            {formatDate(r.scheduledFor)}
                          </span>
                        </span>
                        <Badge
                          tone={
                            r.status === "completed"
                              ? "good"
                              : r.status === "skipped"
                              ? "neutral"
                              : "warn"
                          }
                        >
                          {recallStatusLabel(r.status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sibling requests + Patient LTV */}
          {(siblings.length > 0 || patientLtv != null) && (
            <Card>
              <CardHeader>
                <CardTitle>Patienten-Historie</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {patientLtv != null && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                      Lifetime-Wert dieses Patienten
                    </div>
                    <div className="mt-1 font-display text-3xl font-semibold tabular-nums">
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

          {/* Technical metadata + UTM + raw payload + audit */}
          <Card>
            <CardHeader>
              <CardTitle>Technische Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-3">
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
            </CardContent>
          </Card>

          {/* UTM + raw payload */}
          <Accordion type="multiple">
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
        </>
      )}
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

function recallKindLabel(kind: string): string {
  switch (kind) {
    case "recall":
      return "Recall";
    case "followup":
      return "Followup";
    case "review_request":
      return "Bewertung";
    default:
      return kind;
  }
}

function recallStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Geplant";
    case "sent":
      return "Versendet";
    case "completed":
      return "Erledigt";
    case "skipped":
      return "Übersprungen";
    default:
      return status;
  }
}

function formatDuration(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${Math.round(min)} Min`;
  const hr = min / 60;
  if (hr < 48) return `${hr.toFixed(1).replace(".", ",")} Std`;
  const days = hr / 24;
  return `${Math.round(days)} Tage`;
}
