import { cn } from "@eins/ui";
import { PendingSubmit } from "@/app/(portal)/_components/PendingSubmit";
import { formatDate } from "@/lib/formatting";
import { intervalLabel, MIN_GAPS, MIN_PATIENTS, REMINDER_LEAD_DAYS } from "@/lib/retreatment";
import type { RetreatmentSettingsData, RetreatmentTreatmentSetting } from "@/server/queries/retreatments";
import { renderRetreatmentReminderEmail } from "@/server/email/templates/retreatment-reminder";
import {
  updateRetreatmentSettingsAction,
  updateRetreatmentTreatmentsAction,
} from "@/app/(portal)/wiederbehandlungen/actions";
import { ActionForm } from "@/app/(portal)/_components/ActionForm";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { CONTROL } from "../../dashboard/_components/dash-ui";
import { REMINDER_CONSENT, REMINDER_ENABLE, REMINDER_READ_ONLY } from "../_lib/copy";
import { INTERVAL_LIST, INTERVAL_ROW, ONE_LINE, SLOTS, slots } from "../_lib/sizes";
import { EmailPreview } from "./EmailPreview";
import { INTERVAL_MODE_LABELS } from "../_lib/labels";
import { IntervalField } from "./IntervalField";
import {
  CardBody,
  CardFoot,
  CheckRow,
  FIELD_GRID,
  Field,
  FieldValue,
  SettingsCard,
  Status,
  TextInput,
} from "./settings-ui";

/**
 * Wiederbehandlungen, set once and edited here, in two cards that each save
 * on their own (they were one card with two "Speichern"): the reminder
 * e-mails (`#wiederbehandlungen`, linked from Anfragen and the onboarding
 * hub) and the interval per treatment (`#abstaende`). Everyone sees both,
 * only the Inhaber:in edits.
 */
export function ReminderCard({ data, isInhaber }: { data: RetreatmentSettingsData; isInhaber: boolean }) {
  const preview = renderRetreatmentReminderEmail({
    clinicName: data.clinicName,
    patientName: "Anna Beispiel",
    sincePhrase: "etwa 4 Monate",
    bookingUrl: data.bookingUrl ? data.bookingUrl : null,
    phone: data.phone,
    unsubscribeUrl: "(Link zum Abbestellen)",
  });
  const foot = <EmailPreview subject={preview.subject} text={preview.text} />;

  return (
    <SettingsCard
      id="wiederbehandlungen"
      title={
        // The full name does not fit beside the (i) and the status at 390.
        <>
          <span className="sm:hidden">Erinnerungen</span>
          <span className="hidden sm:inline">Erinnerungen an Folgebehandlungen</span>
        </>
      }
      titleExtra={<ReminderExplainer />}
      action={<Status tone={data.remindersEnabled ? "good" : "none"}>{data.remindersEnabled ? "An" : "Aus"}</Status>}
    >
      {isInhaber ? (
        <ActionForm action={updateRetreatmentSettingsAction}>
          <CardBody className="space-y-5">
            <CheckRow name="consentAttested" defaultChecked={data.consentAttested} label="Patientinnen und Patienten sind informiert">
              {REMINDER_CONSENT}
            </CheckRow>
            <CheckRow name="remindersEnabled" defaultChecked={data.remindersEnabled} label="Erinnerungs-E-Mails einschalten">
              {REMINDER_ENABLE}
            </CheckRow>
            <div className={FIELD_GRID}>
              <Field label="Link zu Ihrer Online-Terminbuchung" htmlFor="bookingUrl">
                <TextInput
                  id="bookingUrl"
                  name="bookingUrl"
                  type="url"
                  defaultValue={data.bookingUrl ?? ""}
                  placeholder="https://"
                  maxLength={500}
                />
              </Field>
              <Field label="Telefonnummer für Termine" htmlFor="phone">
                <TextInput
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={data.phone ?? ""}
                  placeholder="0211 1234567"
                  maxLength={40}
                />
              </Field>
            </div>
          </CardBody>
          <CardFoot start={foot}>
            <PendingSubmit className={cn(CONTROL, "px-4")}>Speichern</PendingSubmit>
          </CardFoot>
        </ActionForm>
      ) : (
        <>
          <CardBody className="space-y-5">
            <div className={FIELD_GRID}>
              <Field label="Link zu Ihrer Online-Terminbuchung">
                <FieldValue>{data.bookingUrl || "Nicht hinterlegt"}</FieldValue>
              </Field>
              <Field label="Telefonnummer für Termine">
                <FieldValue>{data.phone || "Nicht hinterlegt"}</FieldValue>
              </Field>
            </div>
            <p className="text-[15px] leading-6 text-fg-primary">{REMINDER_READ_ONLY}</p>
          </CardBody>
          <CardFoot start={foot}>{null}</CardFoot>
        </>
      )}
    </SettingsCard>
  );
}

function ReminderExplainer() {
  // The card's (i), not a field's: what the e-mail is and when it goes out.
  return (
    <ExplainerPopover term="Erinnerungen">
      <p>
        {REMINDER_LEAD_DAYS} Tage vor dem fälligen Tag bekommt die Person eine kurze E-Mail von Ihrer Praxis mit
        einem Link zu Ihrer Terminbuchung. Die E-Mail nennt keine Behandlung und keinen Preis.
      </p>
      <p className="mt-2">
        Jede Person bekommt höchstens eine Erinnerung in 30 Tagen und kann sich mit einem Klick abmelden. Wer schon
        einen Termin hat, bekommt keine.
      </p>
    </ExplainerPopover>
  );
}

export function IntervalCard({ data, isInhaber }: { data: RetreatmentSettingsData; isInhaber: boolean }) {
  const explain = (
    <>
      <p>
        Automatisch heißt: der übliche Abstand zwischen zwei Behandlungen derselben Art bei Ihren Patientinnen und
        Patienten, aus Ihrer PVS. Wir rechnen erst, wenn es mindestens {MIN_GAPS} Wiederholungen bei {MIN_PATIENTS}{" "}
        verschiedenen Personen gibt.
      </p>
      <p className="mt-2">
        Einmalige Eingriffe stellen Sie auf &bdquo;Nicht im Kalender&ldquo;.
        {data.lastComputedAt ? ` Zuletzt berechnet: ${formatDate(data.lastComputedAt)}.` : ""}
      </p>
    </>
  );
  const list = (
    <ul className={INTERVAL_LIST} style={slots(SLOTS.abstaende)}>
      {data.treatments.map((t) => (
        <li key={t.id} className={INTERVAL_ROW}>
          <div className="min-w-0 lg:flex-1">
            <p className={cn(ONE_LINE, "text-[15px] font-medium leading-5 text-fg-primary")}>{t.name}</p>
            <p className={cn(ONE_LINE, "mt-0.5 text-sm leading-5 text-fg-secondary")}>{pvsLine(t)}</p>
          </div>
          {isInhaber ? (
            <IntervalField id={t.id} name={t.name} mode={t.mode} intervalMonths={t.intervalMonths} />
          ) : (
            <p className="text-[15px] leading-6 text-fg-primary lg:shrink-0">
              {t.mode === "fixed" && t.intervalMonths ? `Alle ${t.intervalMonths} Monate` : INTERVAL_MODE_LABELS[t.mode]}
            </p>
          )}
        </li>
      ))}
      {data.treatments.length === 0 && (
        <li className="py-4 text-[15px] leading-6 text-fg-primary">Für Ihre Praxis sind noch keine Behandlungen angelegt.</li>
      )}
    </ul>
  );

  const title = "Abstand je Behandlung";
  return (
    <SettingsCard id="abstaende" title={title} titleExtra={<ExplainerPopover term={title}>{explain}</ExplainerPopover>}>
      {isInhaber ? (
        // With no treatments yet the foot stays (the card keeps its height),
        // its save greyed out: there is nothing to save.
        <ActionForm action={updateRetreatmentTreatmentsAction}>
          <CardBody>{list}</CardBody>
          <CardFoot>
            <PendingSubmit className={cn(CONTROL, "px-4")} disabled={data.treatments.length === 0}>
              Speichern
            </PendingSubmit>
          </CardFoot>
        </ActionForm>
      ) : (
        <CardBody>{list}</CardBody>
      )}
    </SettingsCard>
  );
}

/** What the PVS says for the treatment; the counts behind it are not needed for the choice. */
function pvsLine(t: RetreatmentTreatmentSetting): string {
  return t.pvsIntervalDays ? `Ihre PVS: ${intervalLabel(t.pvsIntervalDays)}` : "Ihre PVS: noch zu wenig Daten";
}
