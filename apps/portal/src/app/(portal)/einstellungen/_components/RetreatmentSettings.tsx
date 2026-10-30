import { Input } from "@eins/ui";
import { PendingSubmit } from "@/app/(portal)/_components/PendingSubmit";
import { formatDate, formatNumber } from "@/lib/formatting";
import { intervalLabel, MIN_GAPS, MIN_PATIENTS, REMINDER_LEAD_DAYS } from "@/lib/retreatment";
import type { RetreatmentSettingsData, RetreatmentTreatmentSetting } from "@/server/queries/retreatments";
import { renderRetreatmentReminderEmail } from "@/server/email/templates/retreatment-reminder";
import {
  updateRetreatmentSettingsAction,
  updateRetreatmentTreatmentsAction,
} from "@/app/(portal)/wiederbehandlungen/actions";
import { TreatmentModeField } from "@/app/(portal)/wiederbehandlungen/TreatmentModeField";
import { ActionForm } from "@/app/(portal)/_components/ActionForm";

/**
 * Reminder settings for Wiederbehandlungen: set once, edited here.
 * Content only; the page wraps it in its Card. Editing is Inhaber-only.
 */
export function RetreatmentSettings({
  data,
  isInhaber,
}: {
  data: RetreatmentSettingsData;
  isInhaber: boolean;
}) {
  const preview = renderRetreatmentReminderEmail({
    clinicName: data.clinicName,
    patientName: "Anna Beispiel",
    sincePhrase: "etwa 4 Monate",
    bookingUrl: data.bookingUrl ? data.bookingUrl : null,
    phone: data.phone,
    unsubscribeUrl: "(Link zum Abbestellen)",
  });

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <h3 className="text-base font-semibold text-fg-primary">Erinnerungs-E-Mails</h3>
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
      </div>

      <div className="space-y-5 border-t border-border pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-base font-semibold text-fg-primary">Abstand je Behandlung</h3>
          <span className="text-sm text-fg-secondary">{treatmentSummary(data.treatments)}</span>
        </div>
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
          <ActionForm action={updateRetreatmentTreatmentsAction} className="space-y-4">
            <TreatmentList treatments={data.treatments} editable />
            <PendingSubmit>Abstände speichern</PendingSubmit>
          </ActionForm>
        ) : (
          <TreatmentList treatments={data.treatments} editable={false} />
        )}
      </div>
    </div>
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

function ReminderSettingsForm({ data }: { data: RetreatmentSettingsData }) {
  return (
    <ActionForm action={updateRetreatmentSettingsAction} className="grid gap-4 md:grid-cols-2">
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
        <PendingSubmit>Speichern</PendingSubmit>
      </div>
    </ActionForm>
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
