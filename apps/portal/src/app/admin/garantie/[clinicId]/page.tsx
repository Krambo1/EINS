import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import {
  DELAY_KIND_LABELS,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  berlinDate,
  confirmBlockReason,
  formatIsoDate,
  hasContactData,
  rejectionAllowed,
  toDayNumber,
  type DelayKind,
} from "@/lib/guarantee-clock";
import { attemptInfo } from "@/lib/response-time";
import { formatBerlinDateTime } from "@/lib/werkstunden";
import {
  ATTRIBUTION_CHANNEL_LABELS,
  MESSWEG_LABELS,
  NOT_MESSWEG_REASON_LABELS,
  type Attribution,
} from "@/lib/sources";
import { getClinicGuarantee, loadInvoiceDates, type InquirySummary } from "@/server/guarantee-clock";
import { approvalBatchSentDays } from "@/server/content-approval";
import { PendingSubmitButton } from "../../_components/PendingSubmitButton";
import { DangerSubmitButton } from "../../_components/DangerSubmitButton";
import { AdminPageHeader } from "../../_components/AdminPageHeader";
import { ClockStatusBadge } from "../_components/ClockStatusBadge";
import { GARANTIE_FEHLER_COOKIE, parseGarantieFehler } from "../fehler-cookie";
import {
  addStoerungAction,
  addVerzugAction,
  clearInvoiceAction,
  clearManualEndAction,
  closeDelayAction,
  confirmInquiryAction,
  markDelayNotifiedAction,
  rejectInquiryAction,
  removeDelayAction,
  sendVerzugNoticeAction,
  sendStoerungNoticeAction,
  setInvoicePaidAction,
  setInvoiceSentAction,
  setManualEndAction,
  setSignedOnAction,
  undoConfirmationAction,
  undoRejectionAction,
} from "../actions";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Garantie-Uhr · Admin" };

/** Further possible Anfragen rendered before "Weitere N Anfragen anzeigen". */
const OTHERS_SHOWN = 20;

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

interface PageProps {
  params: Promise<{ clinicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminGuaranteeClinicPage({ params, searchParams }: PageProps) {
  await requireAdmin();
  const { clinicId } = await params;
  if (!isUuid(clinicId)) notFound();
  const [g, invoice] = await Promise.all([getClinicGuarantee(clinicId), loadInvoiceDates(clinicId)]);
  if (!g) notFound();
  // Verzug rows the approval job created: "aus Freigabe-Paket vom …".
  const batchSentDays = await approvalBatchSentDays(
    g.delays.map((d) => d.approvalBatchId).filter((v): v is string => !!v)
  );
  const sp = await searchParams;
  // V7 5.6: refused actions hand their message over in a short-lived cookie
  // (see ../fehler-cookie.ts); ?fehler= stays readable for old links.
  const error =
    parseGarantieFehler((await cookies()).get(GARANTIE_FEHLER_COOKIE)?.value, clinicId) ??
    (typeof sp.fehler === "string" ? sp.fehler : null);

  const s = g.state;
  const hasClock = g.clock !== null;
  const decided = s.status !== "laeuft" && s.status !== "beendet_ohne_anfrage";
  const candidate = g.eligible[0] ?? null;
  const others = g.eligible.slice(1);
  // M-4: a busy window holds thousands of possible Anfragen; render the
  // earliest OTHERS_SHOWN unless "?alle=1" asks for all of them.
  const showAllOthers = sp.alle === "1";
  const shownOthers = showAllOthers ? others : others.slice(0, OTHERS_SHOWN);
  const hiddenOthers = others.length - shownOthers.length;
  const progress = hasClock ? Math.min(100, Math.round((s.dayNumber / s.totalDays) * 100)) : 0;

  return (
    <div className="space-y-8">
      <Link
        href="/admin/garantie"
        className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Alle Praxen
      </Link>

      <AdminPageHeader
        title={g.clinicName}
        subtitle="Garantie-Uhr: nur im Admin sichtbar."
        actions={<ClockStatusBadge status={s.status} />}
      />

      {error && (
        <p role="alert" className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] px-4 py-3 text-base text-tone-bad">
          {error}
        </p>
      )}

      {/* Uhr */}
      <Card>
        <CardHeader>
          <CardTitle>Uhr</CardTitle>
          <CardDescription className="!text-sm !text-fg-primary">
            Frist: Unterschrift plus 90 Kalendertage plus Verzugstage. Eine Anfrage am letzten Tag zählt noch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {hasClock ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
                <Stat label="Tag" value={`${s.dayNumber} von ${s.totalDays}`} />
                <Stat
                  label="Resttage"
                  value={s.status === "laeuft" ? String(s.daysLeft) : "–"}
                  emphasis={s.status === "laeuft" && s.daysLeft <= 14}
                />
                <Stat label="Frist" value={formatIsoDate(s.deadline)} />
                <Stat label="Verzugstage" value={String(s.delayDays)} />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-secondary">
                <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-base text-fg-primary">
              Noch kein Unterschriftsdatum. Ohne Datum läuft keine Uhr.
            </p>
          )}

          <form action={setSignedOnAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="clinicId" value={g.clinicId} />
            <div>
              <Label htmlFor="signedOn">Tag der Unterschrift</Label>
              <Input
                id="signedOn"
                name="signedOn"
                type="date"
                required
                defaultValue={g.clock?.signedOn ?? ""}
                className="w-48"
              />
            </div>
            <PendingSubmitButton
              variant="outline"
              confirm={
                hasClock
                  ? "Unterschriftsdatum ändern? Frist und Resttage werden neu berechnet."
                  : undefined
              }
            >
              {hasClock ? "Datum ändern" : "Uhr starten"}
            </PendingSubmitButton>
          </form>
        </CardContent>
      </Card>

      {/* Erste qualifizierte Anfrage */}
      {hasClock && (
        <Card>
          <CardHeader>
            <CardTitle>Erste qualifizierte Anfrage</CardTitle>
            <CardDescription className="!text-sm !text-fg-primary">
              Vorschlag: die früheste Anfrage seit der Unterschrift über einen EINS-Messweg (Formular auf
              EINS-Zielseite, Anruf auf EINS-Tracking-Nummer, Buchung über EINS-Buchungslink). Erst Ihre
              Bestätigung setzt „Rechnung fällig“.
            </CardDescription>
            <p className="text-sm text-fg-primary">
              Messwege live: nur Formular. Anruf und Buchung werden noch nicht erfasst.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {g.confirmed ? (
              <div className="space-y-3">
                <p className="text-base text-fg-primary">
                  Bestätigt: Anfrage vom {formatIsoDate(g.clock?.qualifyingInquiryOn)}, bestätigt von{" "}
                  {g.clock?.qualifyingConfirmedBy ?? "–"} am {formatDateTime(g.clock?.qualifyingConfirmedAt)}.
                </p>
                {g.confirmed.inquiry ? (
                  <InquiryDetails
                    inquiry={g.confirmed.inquiry}
                    attribution={g.confirmed.attribution}
                    ruleStart={g.responseRuleStart}
                  />
                ) : (
                  <p className="text-sm text-fg-secondary">Die Anfrage selbst wurde inzwischen gelöscht.</p>
                )}
                <div className="space-y-3 rounded-md border border-border p-4">
                  <h3 className="text-base font-semibold">Erste Rechnung</h3>
                  {invoice.sentOn ? (
                    <p className="text-base text-fg-primary">
                      Gesendet am {formatIsoDate(invoice.sentOn)}
                      {invoice.paidOn ? `, bezahlt am ${formatIsoDate(invoice.paidOn)}.` : ", noch nicht bezahlt."}
                    </p>
                  ) : (
                    <p className="text-base text-tone-bad">Rechnung fällig, noch nicht als gesendet vermerkt.</p>
                  )}
                  <div className="flex flex-wrap items-end gap-4">
                    {!invoice.sentOn && (
                      <form action={setInvoiceSentAction} className="flex items-end gap-2">
                        <input type="hidden" name="clinicId" value={g.clinicId} />
                        <div>
                          <Label htmlFor="invoice-sent">Gesendet am</Label>
                          <Input id="invoice-sent" name="sentOn" type="date" required defaultValue={g.today} className="w-44" />
                        </div>
                        <PendingSubmitButton variant="outline" size="sm">
                          Speichern
                        </PendingSubmitButton>
                      </form>
                    )}
                    {invoice.sentOn && !invoice.paidOn && (
                      <form action={setInvoicePaidAction} className="flex items-end gap-2">
                        <input type="hidden" name="clinicId" value={g.clinicId} />
                        <div>
                          <Label htmlFor="invoice-paid">Bezahlt am</Label>
                          <Input id="invoice-paid" name="paidOn" type="date" required defaultValue={g.today} className="w-44" />
                        </div>
                        <PendingSubmitButton variant="outline" size="sm">
                          Speichern
                        </PendingSubmitButton>
                      </form>
                    )}
                    {invoice.sentOn && (
                      <form action={clearInvoiceAction}>
                        <input type="hidden" name="clinicId" value={g.clinicId} />
                        <DangerSubmitButton
                          size="sm"
                          confirm="Rechnungsvermerk entfernen? Danach lässt sich die Bestätigung wieder aufheben."
                          pendingLabel="Wird entfernt …"
                        >
                          Vermerk entfernen
                        </DangerSubmitButton>
                      </form>
                    )}
                  </div>
                </div>
                {!invoice.sentOn && (
                  <form action={undoConfirmationAction}>
                    <input type="hidden" name="clinicId" value={g.clinicId} />
                    <DangerSubmitButton
                      size="sm"
                      confirm="Bestätigung aufheben? „Rechnung fällig“ entfällt und die Uhr läuft wieder."
                      pendingLabel="Wird aufgehoben …"
                    >
                      Bestätigung aufheben
                    </DangerSubmitButton>
                  </form>
                )}
              </div>
            ) : decided ? (
              <p className="text-base text-fg-primary">Die Zusammenarbeit ist beendet. Kein Vorschlag mehr.</p>
            ) : candidate ? (
              <div className="space-y-4">
                <Badge tone="accent">Vorschlag</Badge>
                <InquiryDetails
                  inquiry={candidate.row}
                  attribution={candidate.attribution}
                  inquiryOn={candidate.inquiryOn}
                  ruleStart={g.responseRuleStart}
                />
                <InquiryDecision clinicId={g.clinicId} inquiry={candidate.row} ruleStart={g.responseRuleStart} />
              </div>
            ) : (
              <p className="text-base text-fg-primary">
                Noch keine Anfrage über einen EINS-Messweg im Zeitraum.
              </p>
            )}

            {!g.confirmed && !decided && others.length > 0 && (
              <details id="weitere" className="rounded-md border border-border p-4" open={showAllOthers}>
                <summary className="cursor-pointer text-base font-medium">
                  Weitere mögliche Anfragen ({others.length})
                </summary>
                <div className="mt-4 space-y-6">
                  {shownOthers.map((e) => (
                    <div key={e.row.id} className="space-y-3 border-t border-border pt-4 first:border-0 first:pt-0">
                      <InquiryDetails
                        inquiry={e.row}
                        attribution={e.attribution}
                        inquiryOn={e.inquiryOn}
                        ruleStart={g.responseRuleStart}
                      />
                      <InquiryDecision clinicId={g.clinicId} inquiry={e.row} ruleStart={g.responseRuleStart} earlier />
                    </div>
                  ))}
                  {hiddenOthers > 0 && (
                    <Link
                      href={`/admin/garantie/${g.clinicId}?alle=1#weitere`}
                      className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg-primary"
                    >
                      {hiddenOthers === 1
                        ? "1 weitere Anfrage anzeigen"
                        : `Weitere ${formatNumber(hiddenOthers)} Anfragen anzeigen`}
                    </Link>
                  )}
                </div>
              </details>
            )}

            {g.rejected.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-base font-semibold">Abgelehnt</h3>
                <ul className="space-y-2">
                  {g.rejected.map((r) => (
                    <li key={r.rejectionId} className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {formatIsoDate(r.inquiryOn)} · {r.inquiry.contactName ?? "ohne Namen"} ·{" "}
                        {REJECTION_REASON_LABELS[r.reason]}
                        {r.note ? ` (${r.note})` : ""}
                      </span>
                      <form action={undoRejectionAction}>
                        <input type="hidden" name="clinicId" value={g.clinicId} />
                        <input type="hidden" name="rejectionId" value={r.rejectionId} />
                        <DangerSubmitButton
                          size="sm"
                          confirm="Ablehnung aufheben? Die Anfrage kann danach wieder als erste qualifizierte Anfrage zählen."
                          pendingLabel="Wird aufgehoben …"
                        >
                          Ablehnung aufheben
                        </DangerSubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Verzug und Störungen */}
      {hasClock && (
        <Card>
          <CardHeader>
            <CardTitle>Verzug und Plattform-Störungen</CardTitle>
            <CardDescription className="!text-sm !text-fg-primary">
              Jeder Verzugstag verlängert die Frist um einen Tag: vom Tag nach der verpassten Mitwirkungsfrist bis
              zum Tag der Erfüllung. Überlappende Zeiträume zählen einmal. Verzug und Störungen zählen erst, wenn
              sie der Praxis per E-Mail mitgeteilt sind, und nur, wenn die Mitteilung spätestens am Tag des
              damals geltenden Fristendes ging.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {g.delays.length === 0 ? (
              <p className="text-base text-fg-primary">Keine Einträge.</p>
            ) : (
              <ul className="space-y-4">
                {g.delays.map((d) => {
                  const days = d.toDate
                    ? toDayNumber(d.toDate) - toDayNumber(d.fromDate) + 1
                    : Math.max(0, toDayNumber(g.today) - toDayNumber(d.fromDate) + 1);
                  return (
                    <li key={d.id} className="space-y-2 rounded-md border border-border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={d.kind === "verzug" ? "warn" : "neutral"}>
                          {DELAY_KIND_LABELS[d.kind as DelayKind] ?? d.kind}
                        </Badge>
                        <span className="text-base font-medium">
                          {formatIsoDate(d.fromDate)} bis {d.toDate ? formatIsoDate(d.toDate) : "heute (offen)"}
                        </span>
                        <span className="text-sm text-fg-secondary">
                          {days} {days === 1 ? "Tag" : "Tage"}
                        </span>
                        {d.notifiedAt ? (
                          <span className="text-sm text-fg-secondary">
                            mitgeteilt am {formatIsoDate(berlinDate(d.notifiedAt))}
                          </span>
                        ) : (
                          <Badge tone="warn">Nicht mitgeteilt, zählt erst nach Mitteilung</Badge>
                        )}
                      </div>
                      <p className="break-words text-base text-fg-primary [overflow-wrap:anywhere]">{d.reason}</p>
                      {d.approvalBatchId && batchSentDays.get(d.approvalBatchId) && (
                        <p className="text-sm text-fg-secondary">
                          aus Freigabe-Paket vom {formatIsoDate(batchSentDays.get(d.approvalBatchId)!)}, automatisch
                          angelegt. Zählt erst nach der Mitteilung.
                        </p>
                      )}
                      <div className="flex flex-wrap items-end gap-4">
                        {!d.toDate && (
                          <form action={closeDelayAction} className="flex items-end gap-2">
                            <input type="hidden" name="clinicId" value={g.clinicId} />
                            <input type="hidden" name="delayId" value={d.id} />
                            <div>
                              <Label htmlFor={`close-${d.id}`}>
                                {d.kind === "verzug" ? "Erfüllt am" : "Letzter Tag"}
                              </Label>
                              <Input id={`close-${d.id}`} name="toDate" type="date" required className="w-44" />
                            </div>
                            <PendingSubmitButton variant="outline" size="sm">
                              Abschließen
                            </PendingSubmitButton>
                          </form>
                        )}
                        {!d.notifiedAt && d.kind === "plattform_stoerung" && (
                          <form action={sendStoerungNoticeAction}>
                            <input type="hidden" name="clinicId" value={g.clinicId} />
                            <input type="hidden" name="delayId" value={d.id} />
                            <PendingSubmitButton
                              size="sm"
                              pendingLabel="Wird gesendet …"
                              confirm="Störungs-Mitteilung jetzt per E-Mail an die Inhaber und die Praxis-Adresse senden?"
                            >
                              Mitteilung senden
                            </PendingSubmitButton>
                          </form>
                        )}
                        {!d.notifiedAt && d.kind === "verzug" && (
                          <form action={sendVerzugNoticeAction}>
                            <input type="hidden" name="clinicId" value={g.clinicId} />
                            <input type="hidden" name="delayId" value={d.id} />
                            <PendingSubmitButton
                              size="sm"
                              pendingLabel="Wird gesendet …"
                              confirm="Verzugs-Mitteilung jetzt per E-Mail an die Inhaber und die Praxis-Adresse senden?"
                            >
                              Mitteilung senden
                            </PendingSubmitButton>
                          </form>
                        )}
                        {!d.notifiedAt && (
                          <form action={markDelayNotifiedAction} className="flex items-end gap-2">
                            <input type="hidden" name="clinicId" value={g.clinicId} />
                            <input type="hidden" name="delayId" value={d.id} />
                            <div>
                              <Label htmlFor={`notify-${d.id}`}>Per E-Mail mitgeteilt am</Label>
                              <Input
                                id={`notify-${d.id}`}
                                name="notifiedOn"
                                type="date"
                                required
                                defaultValue={g.today}
                                max={g.today}
                                className="w-44"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`beleg-${d.id}`}>Beleg</Label>
                              <Input
                                id={`beleg-${d.id}`}
                                name="beleg"
                                required
                                minLength={3}
                                maxLength={500}
                                placeholder="Betreff und Uhrzeit der E-Mail"
                                className="w-64"
                              />
                            </div>
                            <PendingSubmitButton variant="outline" size="sm">
                              Selbst gesendet, speichern
                            </PendingSubmitButton>
                          </form>
                        )}
                        <form action={removeDelayAction}>
                          <input type="hidden" name="clinicId" value={g.clinicId} />
                          <input type="hidden" name="delayId" value={d.id} />
                          <DangerSubmitButton
                            size="sm"
                            confirm="Eintrag entfernen? Die Frist verkürzt sich um diese Tage."
                            pendingLabel="Wird entfernt …"
                          >
                            Entfernen
                          </DangerSubmitButton>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <form action={addVerzugAction} className="space-y-3 rounded-md border border-border p-4">
                <h3 className="text-base font-semibold">Verzug der Praxis eintragen</h3>
                <input type="hidden" name="clinicId" value={g.clinicId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="v-missed">Mitwirkung fällig am</Label>
                    <Input id="v-missed" name="missedDeadlineOn" type="date" required />
                  </div>
                  <div>
                    <Label htmlFor="v-fulfilled">Erfüllt am (leer: noch offen)</Label>
                    <Input id="v-fulfilled" name="fulfilledOn" type="date" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="v-reason">Grund</Label>
                  <Input
                    id="v-reason"
                    name="reason"
                    required
                    minLength={2}
                    maxLength={500}
                    placeholder="z. B. Klon-Aufnahme fehlt"
                  />
                </div>
                <label className="flex items-start gap-2 text-base">
                  <input type="checkbox" name="sendNotice" value="1" className="mt-1" />
                  Mitteilung jetzt per E-Mail an die Praxis senden (Text wird gespeichert)
                </label>
                <div>
                  <Label htmlFor="v-notified">Oder: selbst per E-Mail mitgeteilt am (optional)</Label>
                  <Input id="v-notified" name="notifiedOn" type="date" max={g.today} />
                </div>
                <div>
                  <Label htmlFor="v-beleg">Beleg zur selbst gesendeten Mitteilung</Label>
                  <Input id="v-beleg" name="beleg" maxLength={500} placeholder="Betreff und Uhrzeit der E-Mail" />
                </div>
                <PendingSubmitButton>Verzug eintragen</PendingSubmitButton>
              </form>

              <form action={addStoerungAction} className="space-y-3 rounded-md border border-border p-4">
                <h3 className="text-base font-semibold">Plattform-Störung eintragen</h3>
                <input type="hidden" name="clinicId" value={g.clinicId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="s-from">Erster Tag</Label>
                    <Input id="s-from" name="fromDate" type="date" required />
                  </div>
                  <div>
                    <Label htmlFor="s-to">Letzter Tag (leer: läuft noch)</Label>
                    <Input id="s-to" name="toDate" type="date" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="s-reason">Grund</Label>
                  <Input
                    id="s-reason"
                    name="reason"
                    required
                    minLength={2}
                    maxLength={500}
                    placeholder="z. B. Instagram-Konto der Praxis gesperrt"
                  />
                </div>
                <div>
                  <Label htmlFor="s-notified">Per E-Mail mitgeteilt am (optional)</Label>
                  <Input id="s-notified" name="notifiedOn" type="date" max={g.today} />
                </div>
                <div>
                  <Label htmlFor="s-beleg">Beleg zur Mitteilung</Label>
                  <Input id="s-beleg" name="beleg" maxLength={500} placeholder="Betreff und Uhrzeit der E-Mail" />
                </div>
                <PendingSubmitButton>Störung eintragen</PendingSubmitButton>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ende */}
      {hasClock && !g.confirmed && (
        <Card>
          <CardHeader>
            <CardTitle>Vorzeitiges Ende</CardTitle>
            <CardDescription className="!text-sm !text-fg-primary">
              Die Praxis kann bis zur ersten Rechnung jederzeit per E-Mail beenden. Bei einer Plattform-Störung ohne
              Einigung kann jede Seite beenden, vor der ersten Rechnung ohne Kosten.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {g.clock?.manualEndState ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-base text-fg-primary">
                  Beendet am {formatIsoDate(g.clock.manualEndOn)}
                  {g.clock.manualEndNote ? `: ${g.clock.manualEndNote}` : ""}
                </span>
                <form action={clearManualEndAction}>
                  <input type="hidden" name="clinicId" value={g.clinicId} />
                  <DangerSubmitButton
                    size="sm"
                    confirm="Ende aufheben? Die Uhr läuft wieder."
                    pendingLabel="Wird aufgehoben …"
                  >
                    Ende aufheben
                  </DangerSubmitButton>
                </form>
              </div>
            ) : (
              <form action={setManualEndAction} className="grid gap-3 md:grid-cols-12 md:items-end">
                <input type="hidden" name="clinicId" value={g.clinicId} />
                <div className="md:col-span-4">
                  <Label htmlFor="end-state">Art</Label>
                  <select id="end-state" name="state" className={SELECT_CLASS} defaultValue="beendet_durch_praxis">
                    <option value="beendet_durch_praxis">Praxis beendet vor der ersten Rechnung</option>
                    <option value="beendet_plattform_stoerung">Beendet wegen Plattform-Störung</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="end-on">Am</Label>
                  <Input id="end-on" name="endedOn" type="date" required defaultValue={g.today} max={g.today} />
                </div>
                <div className="md:col-span-4">
                  <Label htmlFor="end-note">Notiz (optional)</Label>
                  <Input id="end-note" name="note" maxLength={500} />
                </div>
                <div className="md:col-span-2">
                  <DangerSubmitButton
                    confirm="Zusammenarbeit als beendet eintragen? Die Uhr stoppt."
                    pendingLabel="Wird eingetragen …"
                  >
                    Ende eintragen
                  </DangerSubmitButton>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-sm font-medium text-fg-primary">{label}</div>
      <div className={`text-3xl font-semibold tabular-nums ${emphasis ? "text-tone-bad" : ""}`}>{value}</div>
    </div>
  );
}

function InquiryDetails({
  inquiry,
  attribution,
  inquiryOn,
  ruleStart,
}: {
  inquiry: InquirySummary;
  attribution: Attribution | null;
  inquiryOn?: string;
  ruleStart: Date;
}) {
  const noContact = !hasContactData(inquiry);
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      <dt className="font-medium text-fg-primary">Eingang</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
        {formatDateTime(inquiry.createdAt)}
        {inquiryOn ? ` (zählt als ${formatIsoDate(inquiryOn)})` : ""}
      </dd>
      <dt className="font-medium text-fg-primary">Messweg</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
        {attribution?.messweg
          ? MESSWEG_LABELS[attribution.messweg]
          : attribution?.notMesswegReason
            ? `Kein Messweg: ${NOT_MESSWEG_REASON_LABELS[attribution.notMesswegReason]}`
            : "–"}
      </dd>
      <dt className="font-medium text-fg-primary">Kanal</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
        {attribution ? ATTRIBUTION_CHANNEL_LABELS[attribution.channel] : "–"}
        {attribution?.platform ? ` (${attribution.platform})` : ""}
      </dd>
      <dt className="font-medium text-fg-primary">Beitrag</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{attribution?.post ?? "–"}</dd>
      <dt className="font-medium text-fg-primary">Kampagne</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{attribution?.campaign ?? "–"}</dd>
      <dt className="font-medium text-fg-primary">Person</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
        {inquiry.contactName ?? "ohne Namen"}
        {inquiry.contactEmail ? ` · ${inquiry.contactEmail}` : ""}
        {inquiry.contactPhone ? ` · ${inquiry.contactPhone}` : ""}
        {noContact && (
          <Badge tone="warn" className="ml-2">
            Keine Kontaktdaten
          </Badge>
        )}
      </dd>
      <dt className="font-medium text-fg-primary">Behandlung</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{inquiry.treatmentWish ?? "–"}</dd>
      <dt className="font-medium text-fg-primary">Status in der Praxis</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
        {inquiry.status}
        {inquiry.status === "spam" && (
          <Badge tone="warn" className="ml-2">
            Von der Praxis als Spam markiert
          </Badge>
        )}
      </dd>
      <dt className="font-medium text-fg-primary">Kontaktversuch</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{attemptLine(inquiry, ruleStart)}</dd>
    </dl>
  );
}

/** 48-Werkstunden state of the Praxis' first contact attempt (Kanon 6a). */
function attemptLine(inquiry: InquirySummary, ruleStart: Date): React.ReactNode {
  const { state, deadline } = attemptInfo({ ...inquiry, ruleStart }, new Date());
  const frist = formatBerlinDateTime(deadline);
  const at = formatBerlinDateTime(inquiry.firstAttemptAt);
  switch (state) {
    case "rechtzeitig":
      return `Kontaktversuch rechtzeitig am ${at}`;
    case "zu_spaet":
      return <span className="text-tone-bad">{`Kontaktversuch zu spät am ${at} (Frist bis ${frist})`}</span>;
    case "offen":
      return `Keiner, Frist bis ${frist}`;
    case "nicht_beantwortet":
      return <span className="text-tone-bad">{`Keiner, Frist bis ${frist} abgelaufen`}</span>;
    case "ausgenommen":
      return "Keine Frist (Anfrage vor Vertragsbeginn oder vor dem 06.10.2026)";
  }
}

/** Why "Keine erreichbaren Kontaktdaten" is locked for this inquiry, or null. */
function contactObjectionLock(inquiry: InquirySummary, ruleStart: Date): string | null {
  const check = rejectionAllowed("keine_kontaktdaten", {
    hasContactData: hasContactData(inquiry),
    responseState: attemptInfo({ ...inquiry, ruleStart }, new Date()).state,
  });
  return check.ok ? null : check.reason;
}

function InquiryDecision({
  clinicId,
  inquiry,
  ruleStart,
  earlier = false,
}: {
  clinicId: string;
  inquiry: InquirySummary;
  ruleStart: Date;
  /** K-2: an earlier possible inquiry exists (shown above). */
  earlier?: boolean;
}) {
  const requestId = inquiry.id;
  const lock = contactObjectionLock(inquiry, ruleStart);
  const block = confirmBlockReason(
    { hasContactData: hasContactData(inquiry), isSpamMarked: inquiry.status === "spam" },
    { earlierOpen: false, skipEarlier: false }
  );
  return (
    <div className="flex flex-wrap items-end gap-4">
      {block ? (
        <p className="basis-full text-sm text-tone-bad">Bestätigen nicht möglich: {block}</p>
      ) : (
        <form action={confirmInquiryAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="clinicId" value={clinicId} />
          <input type="hidden" name="requestId" value={requestId} />
          {earlier && (
            <div className="basis-full space-y-2 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="skipEarlier" value="1" required />
                Eine frühere Anfrage wird bewusst übersprungen (Grund in der Notiz)
              </label>
              <div>
                <Label htmlFor={`skip-${requestId}`}>Notiz zum Überspringen</Label>
                <Input id={`skip-${requestId}`} name="skipNote" required minLength={5} maxLength={500} className="w-72" />
              </div>
            </div>
          )}
          <PendingSubmitButton confirm="Diese Anfrage als erste qualifizierte Anfrage bestätigen? Damit ist die erste Rechnung fällig.">
            Als erste qualifizierte Anfrage bestätigen
          </PendingSubmitButton>
        </form>
      )}
      <form action={rejectInquiryAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="clinicId" value={clinicId} />
        <input type="hidden" name="requestId" value={requestId} />
        <div>
          <Label htmlFor={`reason-${requestId}`}>Zählt nicht, weil</Label>
          <select id={`reason-${requestId}`} name="reason" required className={SELECT_CLASS} defaultValue="">
            <option value="" disabled>
              Grund wählen
            </option>
            {REJECTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {REJECTION_REASON_LABELS[r]}
                {r === "keine_kontaktdaten" && lock ? " (nur mit Nachweis)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`note-${requestId}`}>Notiz (optional)</Label>
          <Input id={`note-${requestId}`} name="note" maxLength={500} className="w-56" />
        </div>
        <DangerSubmitButton confirm="Diese Anfrage als nicht zählend ablehnen?" pendingLabel="Wird abgelehnt …">
          Ablehnen
        </DangerSubmitButton>
        <p className="basis-full text-sm text-fg-primary">
          Bei „{REJECTION_REASON_LABELS.test_eintrag}“ wird die Anfrage zusätzlich als Spam markiert und zählt bei
          der Praxis nicht mehr als unbeantwortet. Ablehnung aufheben stellt den vorherigen Status wieder her, sofern ihn niemand geändert hat.
        </p>
        {lock && (
          <div className="basis-full space-y-1 text-sm">
            <p className="text-fg-primary">
              „{REJECTION_REASON_LABELS.keine_kontaktdaten}“: {lock}
            </p>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="otherProof" value="1" />
              Die Praxis hat einen früheren Kontaktversuch anders nachgewiesen (in der Notiz festhalten)
            </label>
          </div>
        )}
      </form>
    </div>
  );
}
