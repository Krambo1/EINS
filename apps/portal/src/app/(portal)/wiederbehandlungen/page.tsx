import Link from "next/link";
import { CalendarClock, ChevronDown, CircleCheck, Phone } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { can } from "@/lib/roles";
import { formatDate, formatMoney, formatNumber } from "@/lib/formatting";
import {
  daysBetween,
  intervalLabel,
  MIN_GAPS,
  MIN_PATIENTS,
  REMINDER_LEAD_DAYS,
  REMINDER_SKIP_REASON_LABELS,
  type ReminderSkipReason,
} from "@/lib/retreatment";
import {
  getRetreatmentPageData,
  type RetreatmentListRow,
  type RetreatmentTreatmentSetting,
} from "@/server/queries/retreatments";
import { renderRetreatmentReminderEmail } from "@/server/email/templates/retreatment-reminder";
import {
  dismissRetreatmentAction,
  restoreRetreatmentAction,
  updateRetreatmentSettingsAction,
  updateRetreatmentTreatmentsAction,
} from "./actions";
import { TreatmentModeField } from "./TreatmentModeField";

export const metadata = { title: "Wiederbehandlungen" };

const LIST_LIMIT = 50;

/**
 * Who is due for the next treatment, in the order the team needs it: the call
 * list first, then the next 90 days. Settings (reminder e-mails, interval per
 * treatment) sit folded at the bottom; they are set once and rarely touched.
 */
export default async function WiederbehandlungenPage() {
  const session = await requirePermissionOrRedirect("requests.view");
  const isInhaber = can(session.role, "settings.team");
  const canUpdate = can(session.role, "requests.update");
  const data = await getRetreatmentPageData(session.clinicId, session.userId);
  const money = (cents: number | null) =>
    cents && cents > 0 ? formatMoney(cents / 100, data.currency) : null;
  const persons = (n: number) => (n === 1 ? "Person" : "Personen");

  const preview = renderRetreatmentReminderEmail({
    clinicName: data.clinicName,
    patientName: "Anna Beispiel",
    sincePhrase: "etwa 4 Monate",
    bookingUrl: data.bookingUrl ? data.bookingUrl : null,
    phone: data.phone,
    unsubscribeUrl: "(Link zum Abbestellen)",
  });

  // The Inhaber:in sees the reminder settings open while they are off and people are due:
  // switching them on is then the one useful step on this page.
  const openSettings = isInhaber && !data.remindersEnabled && data.hasAnyRow;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Wiederbehandlungen.</h1>
        <p className="mt-2 max-w-3xl text-base text-fg-primary md:text-lg">
          Wer über EINS kam und bei Ihnen behandelt wurde, erscheint hier, sobald die nächste Behandlung fällig ist.
        </p>
      </header>

      {!data.hasAnyRow ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" aria-hidden />}
          title="Noch niemand fällig"
          description={
            <>
              Die Liste füllt sich, sobald Ihre Praxissoftware verbunden ist und die ersten Patientinnen und
              Patienten aus EINS-Anfragen bei Ihnen behandelt wurden. Wann die nächste Behandlung fällig ist,
              rechnen wir aus Ihren eigenen PVS-Daten.
            </>
          }
        />
      ) : (
        <>
          {data.reminders.remindedTotal > 0 && (
            <p className="text-base text-fg-secondary">
              <span className="font-medium text-fg-primary">Erinnerungen:</span> Diesen Monat{" "}
              {formatNumber(data.reminders.remindedThisMonth)} {persons(data.reminders.remindedThisMonth)} erinnert,
              davon {formatNumber(data.reminders.bookedThisMonth)} mit Termin oder wieder da. Seit Start waren{" "}
              {formatNumber(data.reminders.returnedAfterReminder)} von{" "}
              {formatNumber(data.reminders.remindedTotal)} erinnerten Personen wieder in der Praxis
              {data.reminders.returnedAfterReminderCents > 0
                ? `, zusammen ${formatMoney(data.reminders.returnedAfterReminderCents / 100, data.currency)}`
                : ""}
              .
            </p>
          )}

          {data.overdue.length === 0 && data.upcoming.length === 0 ? (
            <p className="flex items-center gap-3 rounded-lg border border-border bg-bg-primary px-5 py-4 text-base">
              <CircleCheck className="h-5 w-5 shrink-0 text-tone-good" aria-hidden />
              Gerade ist niemand fällig.
            </p>
          ) : (
            <>
              {data.overdue.length > 0 && (
                <RowSection
                  id="anrufen"
                  title="Jetzt anrufen"
                  note="Fällig, aber noch ohne Termin."
                  rows={data.overdue}
                  total={data.overdue.length}
                  moreText={`Die ${LIST_LIMIT} zuletzt fällig gewordenen von ${formatNumber(data.overdue.length)}.`}
                  today={data.today}
                  remindersEnabled={data.remindersEnabled}
                  canUpdate={canUpdate}
                  mode="overdue"
                  money={money}
                />
              )}
              {data.upcoming.length > 0 && (
                <RowSection
                  id="demnaechst"
                  title="Demnächst fällig"
                  note={
                    data.forecast.dueValueCents > 0
                      ? `In den nächsten 90 Tagen, ca. ${formatMoney(data.forecast.dueValueCents / 100, data.currency)} zu Ihren Preisen.`
                      : "In den nächsten 90 Tagen."
                  }
                  rows={data.upcoming}
                  total={data.upcoming.length}
                  moreText={`Die nächsten ${LIST_LIMIT} von ${formatNumber(data.upcoming.length)}.`}
                  today={data.today}
                  remindersEnabled={data.remindersEnabled}
                  canUpdate={canUpdate}
                  mode="upcoming"
                  money={money}
                />
              )}
            </>
          )}
        </>
      )}

      <section id="einstellungen" className="scroll-mt-24 space-y-4" aria-labelledby="einstellungen-titel">
        <h2 id="einstellungen-titel" className="text-xl font-semibold md:text-2xl">
          Einstellungen
        </h2>
        <Card className="divide-y divide-border !py-0 md:!py-0">
          <Fold
            title="Erinnerungs-E-Mails"
            aside={<Badge tone={data.remindersEnabled ? "good" : "neutral"}>{data.remindersEnabled ? "An" : "Aus"}</Badge>}
            open={openSettings}
          >
            <p className="text-base text-fg-primary">
              {REMINDER_LEAD_DAYS} Tage vor dem fälligen Tag bekommt die Person eine kurze E-Mail von Ihrer
              Praxis mit einem Link zu Ihrer Terminbuchung. Die E-Mail nennt keine Behandlung und keinen
              Preis. Jede Person bekommt höchstens eine Erinnerung in 30 Tagen und kann sich mit einem Klick
              abmelden. Wer schon einen Termin hat, bekommt keine.
            </p>
            {isInhaber ? (
              <ReminderSettingsForm data={data} />
            ) : (
              <p className="text-base text-fg-secondary">
                Ein- und ausschalten kann das die Praxisinhaberin oder der Praxisinhaber.
              </p>
            )}
            <details>
              <summary className="cursor-pointer list-none text-base font-medium underline underline-offset-4 [&::-webkit-details-marker]:hidden">
                So sieht die E-Mail aus
              </summary>
              <div className="mt-3 rounded-lg border border-border bg-bg-secondary p-4 text-base">
                <p className="font-medium">Betreff: {preview.subject}</p>
                <p className="mt-3 whitespace-pre-line text-fg-primary">{preview.text}</p>
              </div>
            </details>
          </Fold>

          <Fold
            title="Abstand je Behandlung"
            aside={<span className="text-sm text-fg-secondary">{treatmentSummary(data.treatments)}</span>}
          >
            <p className="text-base text-fg-primary">
              Automatisch heißt: der übliche Abstand zwischen zwei Behandlungen derselben Art bei Ihren
              Patientinnen und Patienten, aus Ihrer PVS. Wir rechnen erst, wenn es mindestens {MIN_GAPS}{" "}
              Wiederholungen bei {MIN_PATIENTS} verschiedenen Personen gibt. Einmalige Eingriffe stellen Sie
              auf &bdquo;Nicht im Kalender&ldquo;.
              {data.lastComputedAt ? ` Zuletzt berechnet: ${formatDate(data.lastComputedAt)}.` : ""}
            </p>
            {data.treatments.length === 0 ? (
              <p className="text-base text-fg-secondary">Für Ihre Praxis sind noch keine Behandlungen angelegt.</p>
            ) : isInhaber ? (
              <form action={updateRetreatmentTreatmentsAction} className="space-y-4">
                <TreatmentList treatments={data.treatments} editable />
                <Button type="submit">Abstände speichern</Button>
              </form>
            ) : (
              <TreatmentList treatments={data.treatments} editable={false} />
            )}
          </Fold>

          {data.dismissed.length > 0 && (
            <Fold
              title="Ausgeblendet"
              aside={
                <span className="text-sm text-fg-secondary">
                  {formatNumber(data.dismissed.length)} {persons(data.dismissed.length)}
                </span>
              }
            >
              <ul className="divide-y divide-border">
            {data.dismissed.slice(0, LIST_LIMIT).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-base">
                <span>
                  <PatientName row={r} />
                  <span className="block text-sm text-fg-secondary">
                    {r.treatmentName} · fällig {formatDate(r.dueOn)}
                  </span>
                </span>
                {canUpdate && (
                  <form action={restoreRetreatmentAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Wieder aufnehmen
                    </Button>
                  </form>
                )}
              </li>
            ))}
              </ul>
            </Fold>
          )}
        </Card>
      </section>
    </div>
  );
}

/** One settings row that folds open. Native details: no client JS, no generated ids. */
function Fold({
  title,
  aside,
  open,
  children,
}: {
  title: string;
  aside: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-4 py-5 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="text-base font-medium">{title}</span>
          {aside}
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-fg-secondary transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-5 pb-6">{children}</div>
    </details>
  );
}

function treatmentSummary(treatments: RetreatmentTreatmentSetting[]): string {
  if (treatments.length === 0) return "Noch keine Behandlungen";
  const auto = treatments.filter((t) => t.mode === "auto").length;
  const fixed = treatments.filter((t) => t.mode === "fixed").length;
  const off = treatments.filter((t) => t.mode === "off").length;
  if (auto === treatments.length) return `Alle ${formatNumber(auto)} automatisch aus Ihrer PVS`;
  return [
    auto > 0 ? `${formatNumber(auto)} automatisch` : null,
    fixed > 0 ? `${formatNumber(fixed)} fest` : null,
    off > 0 ? `${formatNumber(off)} nicht im Kalender` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ReminderSettingsForm({ data }: { data: Awaited<ReturnType<typeof getRetreatmentPageData>> }) {
  return (
    <form action={updateRetreatmentSettingsAction} className="grid gap-4 md:grid-cols-2">
      <label className="flex items-start gap-3 md:col-span-2">
        <input
          type="checkbox"
          name="consentAttested"
          defaultChecked={data.consentAttested}
          className="mt-1 h-5 w-5 shrink-0 rounded border-border"
        />
        <span>
          <span className="block font-medium text-fg-primary">Patientinnen und Patienten sind informiert</span>
          <span className="block text-sm text-fg-secondary">
            Wir sagen bei der Terminvereinbarung, dass wir per E-Mail an eine fällige Folgebehandlung erinnern
            können und dass man dem jederzeit widersprechen kann.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 md:col-span-2">
        <input
          type="checkbox"
          name="remindersEnabled"
          defaultChecked={data.remindersEnabled}
          className="mt-1 h-5 w-5 shrink-0 rounded border-border"
        />
        <span>
          <span className="block font-medium text-fg-primary">Erinnerungs-E-Mails einschalten</span>
          <span className="block text-sm text-fg-secondary">
            Geht nur zusammen mit dem Haken darüber und einem Buchungslink oder einer Telefonnummer.
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="bookingUrl" className="mb-1 block text-sm font-medium">
          Link zu Ihrer Online-Terminbuchung
        </label>
        <Input
          id="bookingUrl"
          name="bookingUrl"
          type="url"
          defaultValue={data.bookingUrl ?? ""}
          placeholder="https://"
          maxLength={500}
        />
      </div>
      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium">
          Telefonnummer für Termine
        </label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={data.phone ?? ""}
          placeholder="0211 1234567"
          maxLength={40}
        />
      </div>

      <div className="md:col-span-2">
        <Button type="submit">Speichern</Button>
      </div>
    </form>
  );
}

function PatientName({ row }: { row: RetreatmentListRow }) {
  const name = row.patientName?.trim() || "Ohne Namen";
  return row.requestId ? (
    <Link href={`/anfragen/${row.requestId}`} className="font-medium underline-offset-4 hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

function ReminderText({ row, remindersEnabled }: { row: RetreatmentListRow; remindersEnabled: boolean }) {
  if (row.status === "booked") {
    return <span>Termin am {formatDate(row.bookedFor)}</span>;
  }
  if (row.reminderStatus === "sent") {
    return (
      <span>
        Erinnert am {formatDate(row.reminderSentAt)}
        {row.bookingClickedAt ? ", Buchungslink geöffnet" : ""}
      </span>
    );
  }
  if (row.reminderStatus === "skipped") {
    const reason = row.reminderSkipReason as ReminderSkipReason | null;
    return (
      <span>
        Keine E-Mail:{" "}
        {reason && REMINDER_SKIP_REASON_LABELS[reason] ? REMINDER_SKIP_REASON_LABELS[reason] : "übersprungen"}
      </span>
    );
  }
  if (!remindersEnabled) return <span>Keine Erinnerung, E-Mails sind aus</span>;
  return <span>Erinnerung {REMINDER_LEAD_DAYS} Tage vorher per E-Mail</span>;
}

function RowSection({
  id,
  title,
  note,
  rows,
  total,
  moreText,
  today,
  remindersEnabled,
  canUpdate,
  mode,
  money,
}: {
  id: string;
  title: string;
  note: string;
  rows: RetreatmentListRow[];
  total: number;
  moreText: string;
  today: string;
  remindersEnabled: boolean;
  canUpdate: boolean;
  mode: "overdue" | "upcoming";
  money: (cents: number | null) => string | null;
}) {
  return (
    <section className="space-y-4" aria-labelledby={id}>
      <div>
        <h2 id={id} className="text-xl font-semibold md:text-2xl">
          {title}
          <span className="ml-2 font-normal text-fg-secondary tabular-nums">{formatNumber(total)}</span>
        </h2>
        <p className="mt-1 text-base text-fg-secondary">{note}</p>
      </div>
      <Card className="!py-2 md:!py-2">
        <ul className="divide-y divide-border">
          {rows.slice(0, LIST_LIMIT).map((r) => {
            const overdueDays = daysBetween(r.dueOn, today);
            const paid = money(r.cycleRevenueCents);
            return (
              <li
                key={r.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="min-w-0">
                  <PatientName row={r} />
                  <p className="mt-0.5 text-sm text-fg-secondary">
                    {[r.treatmentName, `zuletzt ${formatDate(r.cycleOn)}`, paid ? `${paid} bezahlt` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="sm:text-right">
                    <p className="text-base font-medium">
                      {mode === "overdue"
                        ? overdueDays === 1
                          ? "Seit gestern fällig"
                          : `Seit ${formatNumber(overdueDays)} Tagen fällig`
                        : `Fällig am ${formatDate(r.dueOn)}`}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-secondary">
                      <ReminderText row={r} remindersEnabled={remindersEnabled} />
                    </p>
                  </div>
                  {(canUpdate || (mode === "overdue" && r.patientPhone)) && (
                    <div className="flex shrink-0 items-center gap-2 sm:w-[13.5rem] sm:justify-end">
                      {mode === "overdue" && r.patientPhone && (
                        <Button asChild variant="outline" size="sm">
                          <a href={`tel:${r.patientPhone}`}>
                            <Phone className="h-4 w-4" aria-hidden />
                            Anrufen
                          </a>
                        </Button>
                      )}
                      {canUpdate && (
                        <form action={dismissRetreatmentAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            title="Keine Erinnerung, nicht mehr in der Liste"
                          >
                            Ausblenden
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {total > LIST_LIMIT && <p className="text-sm text-fg-secondary">{moreText}</p>}
    </section>
  );
}

const MODE_LABELS = {
  auto: "Automatisch aus Ihrer PVS",
  fixed: "Fester Abstand",
  off: "Nicht im Kalender",
} as const;

function TreatmentList({
  treatments,
  editable,
}: {
  treatments: RetreatmentTreatmentSetting[];
  editable: boolean;
}) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {treatments.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
          <div className="min-w-0">
            <p className="text-base font-medium">{t.name}</p>
            <p className="text-sm text-fg-secondary">
              {t.pvsIntervalDays
                ? `Ihre PVS: ${intervalLabel(t.pvsIntervalDays)}, aus ${formatNumber(t.pvsSamples)} Wiederholungen bei ${formatNumber(t.pvsPatients)} Personen`
                : `Ihre PVS: noch zu wenig Daten${t.pvsSamples > 0 ? ` (${formatNumber(t.pvsSamples)} Wiederholungen)` : ""}`}
            </p>
          </div>
          {editable ? (
            <TreatmentModeField id={t.id} name={t.name} mode={t.mode} intervalMonths={t.intervalMonths} />
          ) : (
            <p className="text-base">
              {t.mode === "fixed" && t.intervalMonths ? `Alle ${t.intervalMonths} Monate` : MODE_LABELS[t.mode]}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
