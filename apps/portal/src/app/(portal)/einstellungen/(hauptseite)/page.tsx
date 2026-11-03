import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  Archive,
  ChevronRight,
  KeyRound,
  Link as LinkIcon,
  MapPin,
  Plus,
  Send,
  Unplug,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Avatar, Button, cn } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { can } from "@/lib/roles";
import { hasMeta, hasGoogle } from "@/lib/env";
import {
  inviteTeamMemberAction,
  removeTeamMemberAction,
  updateOwnProfileAction,
  updateClinicSettingsAction,
  disconnectIntegrationAction,
  createTreatmentAction,
  archiveTreatmentAction,
  createLocationAction,
  archiveLocationAction,
  updateReviewSettingsAction,
  resendInviteAction,
} from "../actions";
import { listTreatments } from "@/server/queries/treatments";
import { listLocations } from "@/server/queries/locations";
import { getRetreatmentSettings } from "@/server/queries/retreatments";
import { isMetaPageSelectionPending } from "@/server/meta-pages";
import { Brand } from "@/app/_components/Brand";
import { QUIET_CONTROL, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { PageHeader } from "../../_components/PageHeader";
import { PendingSubmit } from "../../_components/PendingSubmit";
import { ActionForm } from "../../_components/ActionForm";
import { ReminderCard, IntervalCard } from "../_components/RetreatmentSettings";
import { ConfirmSubmitButton } from "../_components/ConfirmSubmitButton";
import { ReviewSyncButton, ReviewSyncProvider } from "../_components/ReviewSyncButton";
import { WerbekontoStatus, type WerbekontoState } from "../_components/WerbekontoStatus";
import { PlaceIdFinderLink, STERNWERTE_GRID } from "../_components/PlaceIdFinderLink";
import { ScrollToHash } from "../_components/ScrollToHash";
import { SectionMenu, SectionRail } from "../_components/SectionNav";
import {
  CardBody,
  CardFoot,
  CheckRow,
  FIELD_GRID,
  Field,
  FieldValue,
  PRIMARY_BUTTON,
  ROW_BUTTON,
  SECONDARY_BUTTON,
  Select,
  SettingsCard,
  Status,
  SubHead,
  TextInput,
} from "../_components/settings-ui";
import { auditLabel } from "../_audit-label";
import { REVIEW_CONSENT, REVIEW_INTRO, WERBEKONTEN_INTRO } from "../_lib/copy";
import { pvsLine, PVS_VENDOR_LABELS } from "../_lib/pvs";
import { SECTIONS, START_LINKS, type SectionId } from "../_lib/sections";
import { COLUMNS, LINK_ROW, LIST, LIST_ROW, ONE_LINE, SLOTS, STACK, slots } from "../_lib/sizes";

export const metadata = { title: "Einstellungen" };

/**
 * Einstellungen: one column of cards, one per thing a person comes to set
 * (`_lib/sections.ts`), each with its anchor, and the cards to jump to (from
 * xl the rail "Auf dieser Seite", below a list button in the title row). Every
 * card saves on its own, "Speichern" at the right end of its foot; the result
 * comes in the toast. Lists keep their slots and scroll past them, long
 * values scroll sideways on their line, so no card changes size (DESIGN.md
 * section 10). Which cards show follows the role, exactly as before.
 */
export default async function EinstellungenPage() {
  const session = await requireSession();
  const isInhaber = session.role === "inhaber";

  const canViewAudit = can(session.role, "audit.view");

  // D-10: every query below is independent, so they run in parallel, and
  // each selects only the columns this page renders (no encrypted tokens,
  // no password hashes in the render).
  const [clinicRows, teamRows, credentials, treatments, locations, recentAudit, retreatment, pvsRows] =
    await Promise.all([
      db
        .select({
          displayName: schema.clinics.displayName,
          defaultDoctorEmail: schema.clinics.defaultDoctorEmail,
          hwgContactName: schema.clinics.hwgContactName,
          hwgContactEmail: schema.clinics.hwgContactEmail,
          googlePlaceId: schema.clinics.googlePlaceId,
          googleReviewUrl: schema.clinics.googleReviewUrl,
          jamedaProfileUrl: schema.clinics.jamedaProfileUrl,
          jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
          reviewConsentAttested: schema.clinics.reviewConsentAttested,
          reviewInboxEmail: schema.clinics.reviewInboxEmail,
          reviewLandingOrigin: schema.clinics.reviewLandingOrigin,
          reviewRequestDelayDays: schema.clinics.reviewRequestDelayDays,
          reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
        })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, session.clinicId))
        .limit(1),
      isInhaber
        ? db
            .select({
              id: schema.clinicUsers.id,
              email: schema.clinicUsers.email,
              fullName: schema.clinicUsers.fullName,
              role: schema.clinicUsers.role,
              invitedAt: schema.clinicUsers.invitedAt,
              lastLoginAt: schema.clinicUsers.lastLoginAt,
              passwordSetAt: schema.clinicUsers.passwordSetAt,
            })
            .from(schema.clinicUsers)
            .where(
              and(
                eq(schema.clinicUsers.clinicId, session.clinicId),
                isNull(schema.clinicUsers.archivedAt)
              )
            )
            .orderBy(schema.clinicUsers.createdAt)
        : Promise.resolve([]),
      isInhaber
        ? db
            .select({
              platform: schema.platformCredentials.platform,
              accountId: schema.platformCredentials.accountId,
              lastSyncedAt: schema.platformCredentials.lastSyncedAt,
              lastSyncError: schema.platformCredentials.lastSyncError,
              // E6: which Facebook page is bound (id only, no token).
              metaPageId: schema.platformCredentials.metaPageId,
            })
            .from(schema.platformCredentials)
            .where(eq(schema.platformCredentials.clinicId, session.clinicId))
        : Promise.resolve([]),
      listTreatments(session.clinicId, session.userId),
      listLocations(session.clinicId, session.userId),
      // Audit-Log — owner only. The rows contain login times, uploads and
      // IMPERSONATE_START events (incl. EINS admin emails), so the query
      // itself is gated on the same permission that gates the card below.
      // Newest first (the old ascending order showed the first 20 rows ever).
      canViewAudit
        ? db
            .select({
              id: schema.auditLog.id,
              action: schema.auditLog.action,
              entityKind: schema.auditLog.entityKind,
              actorEmail: schema.auditLog.actorEmail,
              impersonatedByAdminId: schema.auditLog.impersonatedByAdminId,
              createdAt: schema.auditLog.createdAt,
            })
            .from(schema.auditLog)
            .where(eq(schema.auditLog.clinicId, session.clinicId))
            .orderBy(desc(schema.auditLog.createdAt))
            .limit(20)
        : Promise.resolve([]),
      getRetreatmentSettings(session.clinicId, session.userId),
      // The Praxis-Software row: which software, and where its link stands.
      db
        .select({
          vendor: schema.pvsLink.pvsVendor,
          status: schema.pvsLink.status,
          lastEventAt: schema.pvsLink.lastEventAt,
        })
        .from(schema.pvsLink)
        .where(eq(schema.pvsLink.clinicId, session.clinicId))
        .limit(1),
    ]);
  const clinic = clinicRows[0];

  const metaCred = credentials.find((c) => c.platform === "meta");
  const googleCred = credentials.find((c) => c.platform === "google");

  // Which cards this role sees: the same rules the cards had before.
  const shows: Record<SectionId, boolean> = {
    profil: true,
    team: isInhaber && can(session.role, "settings.team"),
    "praxis-angaben": isInhaber && !!clinic,
    standorte: can(session.role, "settings.team"),
    behandlungen: can(session.role, "settings.team"),
    bewertungen: isInhaber && !!clinic,
    wiederbehandlungen: true,
    abstaende: true,
    werbekonten: isInhaber && can(session.role, "settings.integrations"),
    "praxis-software": true,
    onboarding: isInhaber,
    audit: canViewAudit,
  };
  const shown = SECTIONS.filter((s) => shows[s.id]).map((s) => ({ id: s.id, title: s.title }));
  const canEditSettings = can(session.role, "settings.team");

  return (
    <div className={STACK}>
      <ScrollToHash />
      <PageHeader title="Einstellungen" actions={<SectionMenu sections={shown} className="xl:hidden" />} />

      <div className={COLUMNS}>
        <div className={STACK}>
          <SettingsCard id="profil" title="Profil">
            <ActionForm action={updateOwnProfileAction}>
              <CardBody>
                <div className={FIELD_GRID}>
                  <Field label="Name" htmlFor="profil-name">
                    <TextInput
                      id="profil-name"
                      name="fullName"
                      defaultValue={session.fullName ?? ""}
                      required
                      maxLength={200}
                      autoComplete="name"
                    />
                  </Field>
                  <Field label="E-Mail">
                    <FieldValue>{session.email}</FieldValue>
                  </Field>
                </div>
              </CardBody>
              {/* Password and signing out everywhere live on their own page
                  (they were a button above all cards): a quiet link at the
                  start of the foot, like Vercel's "Learn more" beside Save. */}
              <CardFoot
                start={
                  <Link href="/einstellungen/sicherheit" className={cn(QUIET_CONTROL, "-ml-2.5")}>
                    <KeyRound className="h-4 w-4" aria-hidden />
                    Passwort ändern
                  </Link>
                }
              >
                <PendingSubmit className={PRIMARY_BUTTON}>Speichern</PendingSubmit>
              </CardFoot>
            </ActionForm>
          </SettingsCard>

          {shows.team && (
            <SettingsCard id="team" title="Team">
              <CardBody className="space-y-5">
                <ActionForm
                  action={inviteTeamMemberAction}
                  className="grid gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <Field label="Name" htmlFor="invite-name">
                    <TextInput id="invite-name" name="fullName" required maxLength={200} autoComplete="off" />
                  </Field>
                  <Field label="E-Mail" htmlFor="invite-email">
                    <TextInput id="invite-email" name="email" type="email" required autoComplete="off" />
                  </Field>
                  <div className="grid gap-4 sm:col-span-2 sm:flex sm:items-end sm:gap-3 xl:col-span-1">
                    <Field label="Rolle" htmlFor="invite-role" className="sm:flex-1 xl:w-64 xl:flex-none">
                      <Select id="invite-role" name="role" defaultValue="marketing">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <PendingSubmit className={cn(PRIMARY_BUTTON, "w-full shrink-0 sm:w-auto")}>
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Einladen
                    </PendingSubmit>
                  </div>
                </ActionForm>

                <ul className={LIST} style={slots(SLOTS.team)}>
                  {teamRows.map((m) => {
                    const isSelf = m.id === session.userId;
                    const name = m.fullName ?? m.email;
                    return (
                      <li key={m.id} className={LIST_ROW}>
                        <Avatar name={name} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className={cn(ONE_LINE, "text-[15px] font-medium leading-5 text-fg-primary")}>
                            {name}
                            {isSelf && <span className="font-normal text-fg-secondary"> (Sie)</span>}
                          </p>
                          <p className={cn(ONE_LINE, "mt-0.5 text-sm leading-5 text-fg-secondary")}>
                            {m.lastLoginAt ? (
                              <Status tone="good">Aktiv</Status>
                            ) : (
                              <Status tone="warn">Einladung offen</Status>
                            )}
                            {!m.lastLoginAt && m.invitedAt && <> · Eingeladen {formatRelative(m.invitedAt)}</>}
                            {" · "}
                            {ROLE_LABELS[m.role as Role] ?? m.role}
                            {" · "}
                            {m.email}
                          </p>
                        </div>
                        {!isSelf && (
                          <div className="flex shrink-0 gap-2">
                            {!m.lastLoginAt && !m.passwordSetAt && (
                              <ActionForm action={resendInviteAction}>
                                <input type="hidden" name="userId" value={m.id} />
                                <PendingSubmit variant="outline" aria-label={`Einladung an ${name} erneut senden`} className={ROW_BUTTON}>
                                  <Send className="h-4 w-4" aria-hidden />
                                  <span className="hidden lg:inline">Erneut senden</span>
                                </PendingSubmit>
                              </ActionForm>
                            )}
                            <ActionForm action={removeTeamMemberAction}>
                              <input type="hidden" name="userId" value={m.id} />
                              <ConfirmSubmitButton
                                variant="outline"
                                aria-label={`${name} entfernen`}
                                className={ROW_BUTTON}
                                confirmText={`${name} wirklich aus dem Team entfernen? Die Person wird sofort abgemeldet.`}
                              >
                                <UserMinus className="h-4 w-4" aria-hidden />
                                <span className="hidden lg:inline">Entfernen</span>
                              </ConfirmSubmitButton>
                            </ActionForm>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </SettingsCard>
          )}

          {shows["praxis-angaben"] && clinic && (
            <SettingsCard id="praxis-angaben" title="Praxis-Angaben">
              <ActionForm action={updateClinicSettingsAction}>
                <CardBody>
                  <div className={FIELD_GRID}>
                    <Field label="Name der Praxis" htmlFor="displayName">
                      <TextInput id="displayName" name="displayName" defaultValue={clinic.displayName} required maxLength={200} />
                    </Field>
                    <Field label="E-Mail der ärztlichen Leitung" htmlFor="defaultDoctorEmail">
                      <TextInput
                        id="defaultDoctorEmail"
                        name="defaultDoctorEmail"
                        type="email"
                        defaultValue={clinic.defaultDoctorEmail ?? ""}
                      />
                    </Field>
                    <Field label="HWG-verantwortliche Person" htmlFor="hwgContactName">
                      <TextInput
                        id="hwgContactName"
                        name="hwgContactName"
                        defaultValue={clinic.hwgContactName ?? ""}
                        maxLength={200}
                      />
                    </Field>
                    <Field label="E-Mail der HWG-verantwortlichen Person" htmlFor="hwgContactEmail">
                      <TextInput
                        id="hwgContactEmail"
                        name="hwgContactEmail"
                        type="email"
                        defaultValue={clinic.hwgContactEmail ?? ""}
                      />
                    </Field>
                  </div>
                </CardBody>
                <CardFoot>
                  <PendingSubmit className={PRIMARY_BUTTON}>Speichern</PendingSubmit>
                </CardFoot>
              </ActionForm>
            </SettingsCard>
          )}

          {shows.standorte && (
            <SettingsCard id="standorte" title="Standorte">
              <CardBody className="space-y-5">
                <ActionForm
                  action={createLocationAction}
                  className="grid gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end"
                >
                  <Field label="Name" htmlFor="location-name">
                    <TextInput id="location-name" name="name" required maxLength={200} />
                  </Field>
                  <Field label="Adresse" htmlFor="location-address">
                    <TextInput id="location-address" name="address" maxLength={500} />
                  </Field>
                  <PendingSubmit className={cn(PRIMARY_BUTTON, "w-full sm:w-auto")}>
                    <MapPin className="h-4 w-4" aria-hidden />
                    Hinzufügen
                  </PendingSubmit>
                </ActionForm>
                <ul className={LIST} style={slots(SLOTS.standorte)}>
                  {locations.map((l) => (
                    <li key={l.id} className={LIST_ROW}>
                      <div className="min-w-0 flex-1">
                        <p className={cn(ONE_LINE, "text-[15px] font-medium leading-5 text-fg-primary")}>{l.name}</p>
                        {(l.isPrimary || l.address) && (
                          <p className={cn(ONE_LINE, "mt-0.5 text-sm leading-5 text-fg-secondary")}>
                            {[l.isPrimary ? "Hauptstandort" : null, l.address].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <ActionForm action={archiveLocationAction} className="shrink-0">
                        <input type="hidden" name="locationId" value={l.id} />
                        <ConfirmSubmitButton
                          variant="outline"
                          aria-label={`Standort „${l.name}“ archivieren`}
                          className={ROW_BUTTON}
                          confirmText={`Standort „${l.name}“ archivieren?`}
                        >
                          <Archive className="h-4 w-4" aria-hidden />
                          <span className="hidden lg:inline">Archivieren</span>
                        </ConfirmSubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                  {locations.length === 0 && <EmptyRow>Noch kein Standort angelegt.</EmptyRow>}
                </ul>
              </CardBody>
            </SettingsCard>
          )}

          {shows.behandlungen && (
            <SettingsCard id="behandlungen" title="Behandlungen">
              <CardBody className="space-y-5">
                <ActionForm
                  action={createTreatmentAction}
                  className="grid gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end"
                >
                  <Field label="Name" htmlFor="treatment-name">
                    <TextInput id="treatment-name" name="name" required maxLength={120} placeholder="z. B. Microneedling" />
                  </Field>
                  <Field
                    label="Stichwörter"
                    htmlFor="treatment-keywords"
                    explain={
                      <p>
                        Name und Stichwörter suchen wir im Text jeder neuen Anfrage, so ordnen wir sie einer Behandlung zu.
                        Mehrere Stichwörter trennen Sie mit Kommas.
                      </p>
                    }
                  >
                    <TextInput id="treatment-keywords" name="keywords" maxLength={500} placeholder="needling, skinpen" />
                  </Field>
                  <PendingSubmit className={cn(PRIMARY_BUTTON, "w-full sm:w-auto")}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Hinzufügen
                  </PendingSubmit>
                </ActionForm>
                <ul className={LIST} style={slots(SLOTS.behandlungen)}>
                  {treatments.map((t) => (
                    <li key={t.id} className={LIST_ROW}>
                      <div className="min-w-0 flex-1">
                        <p className={cn(ONE_LINE, "text-[15px] font-medium leading-5 text-fg-primary")}>{t.name}</p>
                        {t.keywords && (
                          <p className={cn(ONE_LINE, "mt-0.5 text-sm leading-5 text-fg-secondary")}>
                            {t.keywords
                              .split(",")
                              .map((k) => k.trim())
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                      </div>
                      <ActionForm action={archiveTreatmentAction} className="shrink-0">
                        <input type="hidden" name="treatmentId" value={t.id} />
                        <ConfirmSubmitButton
                          variant="outline"
                          aria-label={`Behandlung „${t.name}“ archivieren`}
                          className={ROW_BUTTON}
                          confirmText={`Behandlung „${t.name}“ archivieren? Neue Anfragen werden ihr dann nicht mehr zugeordnet.`}
                        >
                          <Archive className="h-4 w-4" aria-hidden />
                          <span className="hidden lg:inline">Archivieren</span>
                        </ConfirmSubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                  {treatments.length === 0 && <EmptyRow>Noch keine Behandlung angelegt.</EmptyRow>}
                </ul>
              </CardBody>
            </SettingsCard>
          )}

          {shows.bewertungen && clinic && (
            <SettingsCard
              id="bewertungen"
              title="Bewertungen"
              action={
                <Status tone={clinic.reviewRequestEnabled ? "good" : "none"}>
                  {clinic.reviewRequestEnabled ? "An" : "Aus"}
                </Status>
              }
            >
              <ReviewSyncProvider>
                <ActionForm action={updateReviewSettingsAction}>
                  <CardBody className="space-y-5">
                    <p className="text-[15px] leading-6 text-fg-primary">
                      {REVIEW_INTRO.text}
                      <Link
                        href="/bewertungen/feedback"
                        className="rounded-[var(--r-small)] font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {REVIEW_INTRO.link}
                      </Link>
                      .
                    </p>
                    <CheckRow
                      name="reviewRequestEnabled"
                      defaultChecked={clinic.reviewRequestEnabled}
                      label="Bewertungs-Anfragen aktivieren"
                    />
                    <CheckRow
                      name="reviewConsentAttested"
                      defaultChecked={clinic.reviewConsentAttested}
                      label="Einwilligung der Praxis bestätigen"
                    >
                      {REVIEW_CONSENT}
                    </CheckRow>
                    <div className={FIELD_GRID}>
                      <Field
                        label="Google-Bewertungslink"
                        htmlFor="googleReviewUrl"
                        explain={<p>Im Google-Unternehmensprofil unter „Mehr Rezensionen erhalten“.</p>}
                      >
                        <TextInput
                          id="googleReviewUrl"
                          name="googleReviewUrl"
                          type="url"
                          defaultValue={clinic.googleReviewUrl ?? ""}
                          placeholder="https://g.page/r/…/review"
                          maxLength={500}
                        />
                      </Field>
                      <Field label="Jameda-Bewertungslink" htmlFor="jamedaReviewUrl">
                        <TextInput
                          id="jamedaReviewUrl"
                          name="jamedaReviewUrl"
                          type="url"
                          defaultValue={clinic.jamedaReviewUrl ?? ""}
                          placeholder="https://www.jameda.de/…/bewerten/"
                          maxLength={500}
                        />
                      </Field>
                      <Field label="Versand nach dem Termin" htmlFor="reviewRequestDelayDays">
                        <div className="relative">
                          <TextInput
                            id="reviewRequestDelayDays"
                            name="reviewRequestDelayDays"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={30}
                            defaultValue={clinic.reviewRequestDelayDays ?? 3}
                            className="pr-14 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span
                            aria-hidden
                            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] text-fg-secondary"
                          >
                            Tage
                          </span>
                        </div>
                      </Field>
                      <Field label="E-Mail-Postfach für private Rückmeldungen" htmlFor="reviewInboxEmail">
                        <TextInput
                          id="reviewInboxEmail"
                          name="reviewInboxEmail"
                          type="email"
                          defaultValue={clinic.reviewInboxEmail ?? ""}
                          placeholder={clinic.defaultDoctorEmail ?? "praxis@…"}
                          maxLength={200}
                        />
                      </Field>
                      <Field
                        label="Internetadresse für den Link an Patienten"
                        htmlFor="reviewLandingOrigin"
                        className="md:col-span-2"
                        explain={
                          <p>
                            Optional. Unter dieser Adresse öffnen Patienten die Bitte um Bewertung. Wenn leer, nehmen
                            wir die Standard-Praxisseite.
                          </p>
                        }
                      >
                        <TextInput
                          id="reviewLandingOrigin"
                          name="reviewLandingOrigin"
                          type="url"
                          defaultValue={clinic.reviewLandingOrigin ?? ""}
                          placeholder="https://praxis-ihre-praxis.de"
                          maxLength={500}
                        />
                      </Field>
                    </div>

                    <SubHead
                      title="Sternwerte"
                      explain={
                        <p>
                          Jede Nacht holen wir Sternwert und Anzahl der Bewertungen von Google und Jameda und zeigen sie
                          auf der Seite Bewertungen. „Jetzt abrufen“ holt sie sofort.
                        </p>
                      }
                      action={<ReviewSyncButton />}
                    />
                    <div className={STERNWERTE_GRID}>
                      <Field
                        label="Google Place-ID"
                        htmlFor="googlePlaceId"
                        explain={
                          <p>
                            Die feste Nummer Ihrer Praxis bei Google Maps. Im Place-ID-Finder den Praxis-Namen eingeben
                            und die ID kopieren.
                          </p>
                        }
                        aside={<PlaceIdFinderLink />}
                      >
                        <TextInput
                          id="googlePlaceId"
                          name="googlePlaceId"
                          defaultValue={clinic.googlePlaceId ?? ""}
                          placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                          maxLength={255}
                          pattern="[A-Za-z0-9_\-:]+"
                        />
                      </Field>
                      <Field
                        label="Jameda-Profil"
                        htmlFor="jamedaProfileUrl"
                        explain={
                          <p>
                            Die öffentliche Profilseite, ohne „/bewerten/“ am Ende. Dort lesen wir Sternwert und Anzahl ab.
                          </p>
                        }
                      >
                        <TextInput
                          id="jamedaProfileUrl"
                          name="jamedaProfileUrl"
                          type="url"
                          defaultValue={clinic.jamedaProfileUrl ?? ""}
                          placeholder="https://www.jameda.de/berlin/aerzte/…/uebersicht/"
                          maxLength={500}
                        />
                      </Field>
                    </div>
                  </CardBody>
                  <CardFoot>
                    <PendingSubmit className={PRIMARY_BUTTON}>Speichern</PendingSubmit>
                  </CardFoot>
                </ActionForm>
              </ReviewSyncProvider>
            </SettingsCard>
          )}

          <ReminderCard data={retreatment} isInhaber={canEditSettings} />
          <IntervalCard data={retreatment} isInhaber={canEditSettings} />

          {shows.werbekonten && (
            <SettingsCard id="werbekonten" title="Werbekonten">
              <CardBody>
                <p className="text-[15px] leading-6 text-fg-primary">{WERBEKONTEN_INTRO}</p>
                <ul className="mt-4 divide-y divide-border border-t border-border">
                  <IntegrationRow
                    platform="meta"
                    label={<Brand brand="meta">Meta · Facebook & Instagram</Brand>}
                    cred={metaCred ?? null}
                    available={hasMeta()}
                  />
                  <IntegrationRow
                    platform="google"
                    label={<Brand brand="google">Google Ads</Brand>}
                    cred={googleCred ?? null}
                    available={hasGoogle()}
                  />
                </ul>
              </CardBody>
            </SettingsCard>
          )}

          <SettingsCard id="praxis-software" title="Praxis-Software">
            <CardBody className="pt-2">
              <PvsRow link={pvsRows[0] ?? null} canSetUp={can(session.role, "settings.integrations")} />
            </CardBody>
          </SettingsCard>

          {shows.onboarding && (
            <SettingsCard id="onboarding" title="Start-Unterlagen">
              <CardBody className="pt-2">
                <ul className="divide-y divide-border">
                  {START_LINKS.map((l) => (
                    <LinkRow key={l.href} href={l.href}>
                      {l.label}
                    </LinkRow>
                  ))}
                </ul>
              </CardBody>
            </SettingsCard>
          )}

          {shows.audit && (
            <SettingsCard id="audit" title="Protokoll">
              <CardBody>
                <ul className={LIST} style={slots(SLOTS.protokoll)}>
                  {recentAudit.map((a) => {
                    const when = formatDateTime(a.createdAt);
                    const who = [a.actorEmail, a.impersonatedByAdminId ? "durch EINS in Ihrer Ansicht" : null]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={a.id} className={LIST_ROW}>
                        <div className="min-w-0 flex-1">
                          <p className={cn(ONE_LINE, "text-[15px] font-medium leading-5 text-fg-primary")}>
                            {auditLabel(a.action, a.entityKind)}
                          </p>
                          <p
                            className={cn(ONE_LINE, "mt-0.5 text-sm leading-5 text-fg-secondary", !who && "sm:hidden")}
                          >
                            <span className="tabular-nums sm:hidden">
                              {when}
                              {who && " · "}
                            </span>
                            {who}
                          </p>
                        </div>
                        <span className="hidden shrink-0 text-sm tabular-nums text-fg-secondary sm:block">{when}</span>
                      </li>
                    );
                  })}
                  {recentAudit.length === 0 && <EmptyRow>Noch keine Einträge.</EmptyRow>}
                </ul>
              </CardBody>
            </SettingsCard>
          )}
        </div>
        <SectionRail sections={shown} />
      </div>
    </div>
  );
}

/** One sentence where a list has nothing yet, in the list's first slot. */
function EmptyRow({ children }: { children: React.ReactNode }) {
  return <li className="flex h-16 items-center text-[15px] text-fg-primary">{children}</li>;
}

/** A row that is itself the link (Start-Unterlagen): the name and a chevron. */
function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li className={WASH_ROW}>
      <Link
        href={href}
        className={cn(
          LINK_ROW,
          WASH_AREA,
          "justify-between rounded-[var(--r-control)] text-[15px] font-medium text-fg-primary transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        )}
      >
        {children}
        <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden />
      </Link>
    </li>
  );
}

/**
 * The Praxis-Software as one row like the Werbekonten: its name, a dot and
 * where the link stands, and the way to the page behind it. "Einrichten"
 * while nothing is connected (Inhaber), else "Verwalten"; other roles see
 * the page without changing anything ("Ansehen").
 */
function PvsRow({
  link,
  canSetUp,
}: {
  link: { vendor: string; status: string; lastEventAt: Date | null } | null;
  canSetUp: boolean;
}) {
  const vendor = link?.vendor ?? "none";
  const line = pvsLine(link);
  const setUp = vendor === "none" && canSetUp;
  // The Werbekonten row's anatomy: below lg the button takes a line of its
  // own, so a long status never pushes it down in one state and not another.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-[15px] font-medium leading-6 text-fg-primary">
          {vendor === "none" ? "Ihre Praxis-Software" : (PVS_VENDOR_LABELS[vendor] ?? vendor)}
        </p>
        <div className="mt-1 flex min-h-6 items-center">
          <Status tone={line.tone} className="min-w-0 max-w-full">
            <span className={cn(ONE_LINE, "min-w-0")}>{line.text}</span>
          </Status>
        </div>
      </div>
      <div className="flex w-full lg:w-auto">
        <Button asChild variant={setUp ? "default" : "outline"} className={setUp ? PRIMARY_BUTTON : SECONDARY_BUTTON}>
          <Link href={setUp ? "/einstellungen/integrationen/setup" : "/einstellungen/integrationen"}>
            {setUp ? "Einrichten" : canSetUp ? "Verwalten" : "Ansehen"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

interface IntegrationCredential {
  accountId: string | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  metaPageId: string | null;
}

/** Where the account stands: a failed sync first, then a missing Facebook page. */
function werbekontoState(
  platform: "meta" | "google",
  cred: IntegrationCredential | null,
  available: boolean
): WerbekontoState {
  if (!cred) return available ? "missing" : "unavailable";
  // E6: several pages and none chosen is a step left, not a failed sync.
  if (isMetaPageSelectionPending(cred.lastSyncError)) return "page";
  if (cred.lastSyncError) return "error";
  return platform === "meta" && !cred.metaPageId ? "page" : "ok";
}

/**
 * One ad account: name and status line on the left, its actions on the
 * right (DESIGN.md: every action inside its row), hairlines between the rows
 * (they were tinted boxes). The one that fixes the account comes first
 * (Verbinden, Facebook-Seite wählen, Erneut verbinden), Trennen last. Meta
 * keeps "Andere Seite wählen" while it works (E6); Google, while it works,
 * leads to its Kundennummer for the conversion upload (it was a card of its
 * own on the Praxis-Software page). Below lg the actions take a line of
 * their own under the status (short labels on the phone), an empty slot
 * where there is nothing to do, so every row has the same height.
 */
function IntegrationRow({
  platform,
  label,
  cred,
  available,
}: {
  platform: "meta" | "google";
  label: React.ReactNode;
  cred: IntegrationCredential | null;
  available: boolean;
}) {
  const state = werbekontoState(platform, cred, available);
  // Plain <a> for the sign-in: a prefetched Link would hit the OAuth start route.
  const start = `/api/integrations/${platform}/start`;
  return (
    <li data-werbekonto={platform} className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <div className="font-medium text-fg-primary">{label}</div>
        <WerbekontoStatus
          state={state}
          lastSyncedAt={cred?.lastSyncedAt ?? null}
          accountId={cred?.accountId ?? null}
          pageId={cred?.metaPageId ?? null}
          error={cred?.lastSyncError ?? null}
        />
      </div>
      <div className="flex w-full gap-2 lg:w-auto">
        {state === "unavailable" && <span aria-hidden className="h-[var(--control-h)]" />}
        {state === "missing" && (
          <Button asChild className={PRIMARY_BUTTON}>
            <a href={start}>
              <LinkIcon className="h-4 w-4" aria-hidden />
              Verbinden
            </a>
          </Button>
        )}
        {state === "error" && (
          <Button asChild className={PRIMARY_BUTTON}>
            <a href={start}>
              <LinkIcon className="h-4 w-4" aria-hidden />
              Erneut verbinden
            </a>
          </Button>
        )}
        {platform === "meta" && (state === "page" || state === "ok") && (
          <Button
            asChild
            variant={state === "page" ? "default" : "outline"}
            className={state === "page" ? PRIMARY_BUTTON : SECONDARY_BUTTON}
          >
            <Link href="/einstellungen/integrationen/meta-seite">
              <span className="sm:hidden">{state === "page" ? "Seite wählen" : "Seite ändern"}</span>
              <span className="hidden sm:inline">
                {state === "page" ? "Facebook-Seite wählen" : "Andere Seite wählen"}
              </span>
            </Link>
          </Button>
        )}
        {platform === "google" && state === "ok" && (
          <Button asChild variant="outline" className={SECONDARY_BUTTON}>
            <Link href="/einstellungen/integrationen/ads-conversion">Kundennummer</Link>
          </Button>
        )}
        {cred && (
          <ActionForm action={disconnectIntegrationAction}>
            <input type="hidden" name="platform" value={platform} />
            <ConfirmSubmitButton
              variant="outline"
              className={SECONDARY_BUTTON}
              confirmText="Verbindung wirklich trennen? Danach fließen keine Werbezahlen mehr in Ihre Auswertung, bis Sie neu verbinden."
            >
              <Unplug className="h-4 w-4" aria-hidden />
              Trennen
            </ConfirmSubmitButton>
          </ActionForm>
        )}
      </div>
    </li>
  );
}
