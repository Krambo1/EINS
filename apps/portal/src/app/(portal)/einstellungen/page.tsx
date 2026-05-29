import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Separator,
} from "@eins/ui";
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
  rotateIntakeSecretAction,
  consumeIntakeSecretFlash,
  syncReviewsNowAction,
  consumeReviewSyncFlash,
} from "./actions";
import { env } from "@/lib/env";
import {
  UserPlus,
  Trash2,
  Link as LinkIcon,
  Unplug,
  Plus,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { listTreatments } from "@/server/queries/treatments";
import { listLocations } from "@/server/queries/locations";
import { Brand } from "@/app/_components/Brand";
import { AvatarUploader } from "./_components/AvatarUploader";
import { Avatar } from "@eins/ui";
import { avatarUrlForKey } from "@/server/avatars";

export const metadata = { title: "Einstellungen" };

export default async function EinstellungenPage() {
  const session = await requireSession();
  const isInhaber = session.role === "inhaber";

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);

  // One-shot flash: plaintext of a freshly rotated intake/HMAC secret.
  // Showed once, then the cookie is wiped. Only Inhaber can trigger rotation.
  const flashedIntakeSecret = isInhaber ? await consumeIntakeSecretFlash() : null;

  // One-shot flash: per-platform outcome of the manual review sync.
  const flashedReviewSync = isInhaber ? await consumeReviewSyncFlash() : null;

  const teamRows = isInhaber
    ? await db
        .select()
        .from(schema.clinicUsers)
        .where(
          and(
            eq(schema.clinicUsers.clinicId, session.clinicId),
            isNull(schema.clinicUsers.archivedAt)
          )
        )
        .orderBy(schema.clinicUsers.createdAt)
    : [];
  const team = teamRows.map((m) => ({
    ...m,
    avatarUrl: avatarUrlForKey(m.avatarKey, m.avatarUpdatedAt),
  }));

  const credentials = isInhaber
    ? await db
        .select()
        .from(schema.platformCredentials)
        .where(eq(schema.platformCredentials.clinicId, session.clinicId))
    : [];

  const metaCred = credentials.find((c) => c.platform === "meta");
  const googleCred = credentials.find((c) => c.platform === "google");

  const [treatments, locations, recentAudit] = await Promise.all([
    listTreatments(session.clinicId, session.userId),
    listLocations(session.clinicId, session.userId),
    db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        entityKind: schema.auditLog.entityKind,
        actorEmail: schema.auditLog.actorEmail,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.clinicId, session.clinicId))
      .orderBy(schema.auditLog.createdAt)
      .limit(20),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Einstellungen.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihr Profil, Ihr Team und Ihre Verbindungen zu Meta und Google.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/einstellungen/sicherheit">
              Passwort &amp; Sicherheit
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/einstellungen/integrationen">Integrationen</Link>
          </Button>
        </div>
      </header>

      {/* My profile — everyone */}
      <Card id="profil" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Mein Profil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium">Profilbild</label>
            <AvatarUploader
              currentUrl={session.avatarUrl}
              name={session.fullName}
              email={session.email}
            />
            <p className="mt-2 text-xs text-fg-secondary">
              JPG, PNG oder WebP — wird quadratisch auf 512&times;512 zugeschnitten.
            </p>
          </div>
          <form
            action={updateOwnProfileAction}
            className="grid gap-4 md:grid-cols-[1fr_auto]"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input
                  name="fullName"
                  defaultValue={session.fullName ?? ""}
                  required
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">E-Mail</label>
                <Input defaultValue={session.email} readOnly disabled />
                <p className="mt-1 text-xs text-fg-secondary">
                  Änderung auf Anfrage.
                </p>
              </div>
            </div>
            <div className="md:self-start">
              <span
                aria-hidden="true"
                className="mb-1 hidden text-sm font-medium md:block"
              >
                &nbsp;
              </span>
              <Button type="submit">Speichern</Button>
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
            <span className="text-fg-secondary">Rolle:</span>
            <Badge tone="neutral">
              {ROLE_LABELS[session.role as Role] ?? session.role}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Clinic settings — Inhaber only */}
      {isInhaber && clinic && (
        <Card id="praxis-angaben" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Praxis-Angaben</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={updateClinicSettingsAction}
              className="grid gap-4 md:grid-cols-2"
            >
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Name der Praxis
                </label>
                <Input
                  name="displayName"
                  defaultValue={clinic.displayName}
                  required
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  E-Mail der leitenden Ärztin / des leitenden Arztes
                </label>
                <Input
                  name="defaultDoctorEmail"
                  type="email"
                  defaultValue={clinic.defaultDoctorEmail ?? ""}
                />
                <p className="mt-1 text-xs text-fg-secondary">
                  Erscheint in Video-Produktionen und HWG-Prüfungen.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  HWG-Verantwortliche:r (Name)
                </label>
                <Input
                  name="hwgContactName"
                  defaultValue={clinic.hwgContactName ?? ""}
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  HWG-Verantwortliche:r (E-Mail)
                </label>
                <Input
                  name="hwgContactEmail"
                  type="email"
                  defaultValue={clinic.hwgContactEmail ?? ""}
                />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit">Speichern</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* EINS Stimme — Bewertungen & Reputation. Inhaber only. */}
      {isInhaber && clinic && (
        <Card id="bewertungen" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Bewertungen &amp; Reputation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-fg-secondary">
              Nach jedem Termin geht eine Bitte um Rückmeldung an die
              Patient:in. Hohe Bewertungen werden zu Google &amp; Jameda
              eingeladen, kritische landen vertraulich in Ihrem{" "}
              <Link
                href="/bewertungen/feedback"
                className="text-fg-primary underline underline-offset-4"
              >
                Patientenfeedback-Postfach
              </Link>
              .
            </p>

            <form
              action={updateReviewSettingsAction}
              className="grid gap-4 md:grid-cols-2"
            >
              <label className="md:col-span-2 flex items-center gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4">
                <input
                  type="checkbox"
                  name="reviewRequestEnabled"
                  defaultChecked={clinic.reviewRequestEnabled}
                  className="h-5 w-5 rounded border-border"
                />
                <span>
                  <span className="block font-medium text-fg-primary">
                    Bewertungs-Anfragen aktivieren
                  </span>
                  <span className="block text-sm text-fg-secondary">
                    Nur aktivieren, wenn Sie Patient:innen bei Termin-
                    vereinbarung über die spätere E-Mail informieren
                    (siehe Onboarding-Checkliste).
                  </span>
                </span>
              </label>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Google-Bewertungs-URL
                </label>
                <Input
                  name="googleReviewUrl"
                  type="url"
                  defaultValue={clinic.googleReviewUrl ?? ""}
                  placeholder="https://g.page/r/…/review"
                  maxLength={500}
                />
                <p className="mt-1 text-xs text-fg-secondary">
                  Aus dem „Google Business"-Profil unter „Mehr Rezensionen
                  erhalten".
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Jameda-Bewertungs-URL
                </label>
                <Input
                  name="jamedaReviewUrl"
                  type="url"
                  defaultValue={clinic.jamedaReviewUrl ?? ""}
                  placeholder="https://www.jameda.de/…/bewerten/"
                  maxLength={500}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Versand X Tage nach Termin
                </label>
                <Input
                  name="reviewRequestDelayDays"
                  type="number"
                  min={0}
                  max={30}
                  defaultValue={clinic.reviewRequestDelayDays ?? 3}
                />
                <p className="mt-1 text-xs text-fg-secondary">
                  Empfohlen: 3 Tage. So sind frische Eindrücke noch präsent,
                  aber Schwellungen / Erströtungen sind schon abgeklungen.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Praxis-Domain für Patient:innen-Link
                </label>
                <Input
                  name="reviewLandingOrigin"
                  type="url"
                  defaultValue={clinic.reviewLandingOrigin ?? ""}
                  placeholder="https://praxis-ihre-praxis.de"
                  maxLength={500}
                />
                <p className="mt-1 text-xs text-fg-secondary">
                  Optional: wenn leer, nehmen wir die Standard-Praxisseite.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  E-Mail-Postfach für private Rückmeldungen
                </label>
                <Input
                  name="reviewInboxEmail"
                  type="email"
                  defaultValue={clinic.reviewInboxEmail ?? ""}
                  placeholder={clinic.defaultDoctorEmail ?? "praxis@…"}
                  maxLength={200}
                />
                <p className="mt-1 text-xs text-fg-secondary">
                  Wenn leer, geht die Benachrichtigung an die leitende
                  Ärztin / den leitenden Arzt.
                </p>
              </div>

              <div className="md:col-span-2 mt-4 rounded-xl border border-border bg-bg-secondary/40 p-4">
                <h3 className="text-sm font-semibold text-fg-primary">
                  Live-Synchronisation der Bewertungen
                </h3>
                <p className="mt-1 text-sm text-fg-secondary">
                  Hinterlegen Sie pro Plattform die Profil-ID. Wir holen
                  jede Nacht (04:00 UTC) automatisch Sternwert und Anzahl
                  der Bewertungen von Google und Jameda und zeigen sie auf
                  der Bewertungen-Seite an.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Google Place-ID
                </label>
                <Input
                  name="googlePlaceId"
                  defaultValue={clinic.googlePlaceId ?? ""}
                  placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                  maxLength={255}
                  pattern="[A-Za-z0-9_\-:]+"
                />
                <p className="mt-1 text-xs text-fg-secondary">
                  Finden Sie unter{" "}
                  <a
                    href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    Place-ID-Finder
                  </a>
                  . Praxis-Namen eingeben → ID kopieren.
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">
                  Jameda-Profil-URL
                </label>
                <Input
                  name="jamedaProfileUrl"
                  type="url"
                  defaultValue={clinic.jamedaProfileUrl ?? ""}
                  placeholder="https://www.jameda.de/berlin/aerzte/…/uebersicht/"
                  maxLength={500}
                />
                <p className="mt-1 text-xs text-fg-secondary">
                  Die öffentliche Profilseite (ohne „/bewerten/" am Ende).
                  Jameda hat keine API — wir lesen die Bewertung aus den
                  strukturierten Daten der Profilseite aus.
                </p>
              </div>

              <div className="md:col-span-2 flex justify-end">
                <Button type="submit">Speichern</Button>
              </div>
            </form>

            {/* Manual sync trigger + last-run flash */}
            <div className="rounded-xl border border-border bg-bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-fg-primary">
                    Jetzt synchronisieren
                  </h3>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Holt sofort die aktuellen Werte von Google und Jameda.
                    Nützlich nach dem ersten Hinterlegen der Profil-IDs
                    &mdash; sonst läuft der Abgleich täglich automatisch.
                  </p>
                </div>
                <form action={syncReviewsNowAction}>
                  <Button type="submit" variant="outline" size="sm">
                    <RefreshCw className="h-4 w-4" />
                    Jetzt aktualisieren
                  </Button>
                </form>
              </div>
              {flashedReviewSync && (
                <ul className="mt-3 space-y-1 text-sm">
                  {flashedReviewSync.map((o) => (
                    <li key={o.platform} className="flex items-center gap-2">
                      {o.ok ? (
                        <Badge tone="good">OK</Badge>
                      ) : (
                        <Badge tone="warn">Fehler</Badge>
                      )}
                      <span className="font-medium text-fg-primary capitalize">
                        {o.platform}
                      </span>
                      {!o.ok && o.error && (
                        <span className="text-fg-secondary truncate">
                          · {o.error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Separator />

            {/* Make.com webhook info */}
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-fg-primary">
                  Make.com-Anbindung
                </h3>
                <p className="mt-1 text-sm text-fg-secondary">
                  Konfigurieren Sie ein Make-Szenario pro
                  Praxis-Verwaltungssystem (Doctolib, Charly, ivoris, Z1,
                  Dampsoft). Jeder „Termin abgeschlossen"-Trigger schickt
                  einen signierten Webhook an folgende Adresse:
                </p>
              </div>
              <div className="rounded-xl border border-border bg-bg-secondary/40 p-3 font-mono text-xs">
                <div className="text-fg-secondary">Webhook-URL</div>
                <div className="mt-1 break-all text-fg-primary">
                  {env.APP_ORIGIN}/api/patients/events
                </div>
              </div>
              <div className="rounded-xl border border-border bg-bg-secondary/40 p-3 font-mono text-xs">
                <div className="text-fg-secondary">Praxis-ID (clinicId)</div>
                <div className="mt-1 break-all text-fg-primary">{clinic.id}</div>
              </div>
              <div className="rounded-xl border border-border bg-bg-secondary/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs text-fg-secondary">
                      HMAC-Geheimnis (X-EINS-Signature)
                    </div>
                    <p className="mt-1 text-xs text-fg-secondary">
                      Wird beim Rotieren einmalig angezeigt. Speichern Sie ihn
                      sofort in Make. Bei Rotation ist Ihr bisheriger
                      Webhook bis zur Aktualisierung in Make ungültig &mdash;
                      auch für Ihre Landingpage-Formulare.
                    </p>
                  </div>
                  <form action={rotateIntakeSecretAction}>
                    <Button type="submit" variant="outline" size="sm">
                      Geheimnis rotieren
                    </Button>
                  </form>
                </div>
                {flashedIntakeSecret && (
                  <div className="mt-3 rounded-lg border border-fg-primary/30 bg-bg-primary p-3">
                    <div className="text-xs font-semibold text-fg-primary">
                      Neues Geheimnis (einmalig sichtbar):
                    </div>
                    <code className="mt-1 block break-all font-mono text-sm text-fg-primary">
                      {flashedIntakeSecret}
                    </code>
                    <p className="mt-2 text-xs text-fg-secondary">
                      Wenn Sie diese Seite verlassen, ist das Geheimnis nicht
                      mehr aus dem Portal abrufbar. Bei Verlust rotieren Sie
                      es einfach erneut.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team — Inhaber only */}
      {isInhaber && can(session.role, "settings.team") && (
        <Card id="team" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Invite form */}
            <form
              action={inviteTeamMemberAction}
              className="grid gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4 md:grid-cols-[1fr_1fr_auto_auto]"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-secondary">
                  Name
                </label>
                <Input name="fullName" required maxLength={200} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-secondary">
                  E-Mail
                </label>
                <Input name="email" type="email" required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-secondary">
                  Rolle
                </label>
                <select
                  name="role"
                  defaultValue="marketing"
                  className="h-11 rounded-xl border border-border bg-bg-primary px-3 text-base"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full md:w-auto">
                  <UserPlus className="h-4 w-4" />
                  Einladen
                </Button>
              </div>
            </form>

            <Separator />

            {/* Existing members */}
            <ul className="divide-y divide-border">
              {team.map((m) => {
                const isSelf = m.id === session.userId;
                return (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        src={m.avatarUrl}
                        name={m.fullName ?? m.email}
                        size="lg"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-fg-primary">
                            {m.fullName ?? m.email}
                          </span>
                          {isSelf && (
                            <Badge tone="neutral">Sie</Badge>
                          )}
                          <Badge tone="neutral">
                            {ROLE_LABELS[m.role as Role] ?? m.role}
                          </Badge>
                          {m.lastLoginAt ? (
                            <Badge tone="good">Aktiv</Badge>
                          ) : (
                            <Badge tone="warn">Einladung offen</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-sm text-fg-secondary">
                          {m.email}
                          {m.lastLoginAt && (
                            <> · Letzter Login {formatRelative(m.lastLoginAt)}</>
                          )}
                          {!m.lastLoginAt && m.invitedAt && (
                            <> · Eingeladen {formatRelative(m.invitedAt)}</>
                          )}
                        </div>
                      </div>
                    </div>
                    {!isSelf && (
                      <div className="flex gap-2">
                        <form action={removeTeamMemberAction}>
                          <input type="hidden" name="userId" value={m.id} />
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                          >
                            <Trash2 className="h-4 w-4" />
                            Entfernen
                          </Button>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Integrations — Inhaber only */}
      {isInhaber && can(session.role, "settings.integrations") && (
        <Card id="werbekonten" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Werbekonten verbinden</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <IntegrationRow
              platform="meta"
              label={<Brand brand="meta">Meta · Facebook & Instagram</Brand>}
              connected={!!metaCred}
              accountId={metaCred?.accountId ?? null}
              lastSyncedAt={metaCred?.lastSyncedAt ?? null}
              available={hasMeta()}
            />
            <IntegrationRow
              platform="google"
              label={<Brand brand="google">Google Ads</Brand>}
              connected={!!googleCred}
              accountId={googleCred?.accountId ?? null}
              lastSyncedAt={googleCred?.lastSyncedAt ?? null}
              available={hasGoogle()}
            />
          </CardContent>
        </Card>
      )}

      {/* Treatments CRUD */}
      {can(session.role, "settings.team") && (
            <Card id="behandlungen" className="scroll-mt-24">
              <CardHeader>
                <CardTitle>Behandlungs-Kategorien</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-fg-secondary">
                  Diese Kategorien sortieren neue Anfragen automatisch nach
                  Behandlungsart. Stichwörter werden im Anfrage-Text gesucht.
                </p>
                <form
                  action={createTreatmentAction}
                  className="grid gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4 md:grid-cols-[1fr_1fr_1.5fr_auto]"
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Name
                    </label>
                    <Input name="name" required maxLength={120} placeholder="z. B. Microneedling" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Kürzel (slug)
                    </label>
                    <Input
                      name="slug"
                      required
                      maxLength={60}
                      pattern="[a-z0-9\-]+"
                      placeholder="microneedling"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Stichwörter (Komma-getrennt)
                    </label>
                    <Input name="keywords" maxLength={500} placeholder="needling, skinpen" />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" className="w-full md:w-auto">
                      <Plus className="h-4 w-4" /> Hinzufügen
                    </Button>
                  </div>
                </form>

                <ul className="divide-y divide-border">
                  {treatments.map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-2">
                      <div>
                        <span className="font-medium text-fg-primary">{t.name}</span>
                        <span className="ml-2 text-xs text-fg-secondary">
                          {t.slug}
                        </span>
                        {t.keywords && (
                          <div className="mt-0.5 text-xs text-fg-tertiary">
                            Stichwörter: {t.keywords}
                          </div>
                        )}
                      </div>
                      <form action={archiveTreatmentAction}>
                        <input type="hidden" name="treatmentId" value={t.id} />
                        <Button type="submit" variant="outline" size="sm">
                          <Trash2 className="h-4 w-4" />
                          Archivieren
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Locations CRUD */}
          {can(session.role, "settings.team") && (
            <Card id="standorte" className="scroll-mt-24">
              <CardHeader>
                <CardTitle>Standorte</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  action={createLocationAction}
                  className="grid gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4 md:grid-cols-[1fr_2fr_auto]"
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Name
                    </label>
                    <Input name="name" required maxLength={200} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Adresse (optional)
                    </label>
                    <Input name="address" maxLength={500} />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" className="w-full md:w-auto">
                      <MapPin className="h-4 w-4" />
                      Hinzufügen
                    </Button>
                  </div>
                </form>
                <ul className="divide-y divide-border">
                  {locations.map((l) => (
                    <li key={l.id} className="flex items-center justify-between py-2">
                      <div>
                        <span className="font-medium text-fg-primary">{l.name}</span>
                        {l.isPrimary && <Badge tone="accent">Hauptstandort</Badge>}
                        {l.address && (
                          <div className="mt-0.5 text-xs text-fg-secondary">
                            {l.address}
                          </div>
                        )}
                      </div>
                      <form action={archiveLocationAction}>
                        <input type="hidden" name="locationId" value={l.id} />
                        <Button type="submit" variant="outline" size="sm">
                          <Trash2 className="h-4 w-4" />
                          Archivieren
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Audit log preview */}
          {recentAudit.length > 0 && (
            <Card id="audit" className="scroll-mt-24">
              <CardHeader>
                <CardTitle>Audit-Log (letzte 20 Aktionen)</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {recentAudit.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between py-1.5 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs uppercase text-fg-secondary">
                          {a.action}
                        </span>
                        <span className="ml-2 text-fg-primary">
                          {a.entityKind ?? "—"}
                        </span>
                        {a.actorEmail && (
                          <span className="ml-2 text-fg-secondary">
                            · {a.actorEmail}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-fg-tertiary tabular-nums">
                        {formatDateTime(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {clinic && (
            <Card id="technische-details" className="scroll-mt-24">
              <CardHeader>
                <CardTitle>Technische Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <span className="text-fg-secondary">Praxis-ID:</span>{" "}
                  <code className="font-mono">{clinic.id}</code>
                </div>
                <div>
                  <span className="text-fg-secondary">Kunde seit:</span>{" "}
                  {formatDateTime(clinic.createdAt)}
                </div>
                <div>
                  <span className="text-fg-secondary">Ihr Nutzer-ID:</span>{" "}
                  <code className="font-mono">{session.userId}</code>
                </div>
              </CardContent>
        </Card>
      )}
    </div>
  );
}

function IntegrationRow({
  platform,
  label,
  connected,
  accountId,
  lastSyncedAt,
  available,
}: {
  platform: "meta" | "google";
  label: React.ReactNode;
  connected: boolean;
  accountId: string | null;
  lastSyncedAt: Date | null;
  available: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg-primary">{label}</span>
          {connected ? (
            <Badge tone="good">Verbunden</Badge>
          ) : (
            <Badge tone="neutral">Nicht verbunden</Badge>
          )}
        </div>
        {connected ? (
          <div className="mt-1 text-xs text-fg-secondary">
            Konto-ID: {accountId ?? "—"} · Abgleich:{" "}
            {lastSyncedAt ? formatRelative(lastSyncedAt) : "noch nie"}
          </div>
        ) : !available ? (
          <div className="mt-1 text-xs text-fg-secondary">
            Diese Verbindung ist in Ihrer Umgebung noch nicht konfiguriert.
            Bitte wenden Sie sich an EINS.
          </div>
        ) : (
          <div className="mt-1 text-xs text-fg-secondary">
            Einmalig verbinden, danach synchronisieren wir täglich.
          </div>
        )}
      </div>
      {connected ? (
        <form action={disconnectIntegrationAction}>
          <input type="hidden" name="platform" value={platform} />
          <Button type="submit" variant="outline" size="sm">
            <Unplug className="h-4 w-4" />
            Trennen
          </Button>
        </form>
      ) : available ? (
        <Button asChild size="sm">
          <Link href={`/api/integrations/${platform}/start`}>
            <LinkIcon className="h-4 w-4" />
            Verbinden
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
