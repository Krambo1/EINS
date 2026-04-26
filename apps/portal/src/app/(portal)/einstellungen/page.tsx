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
  resetMemberMfaAction,
  updateOwnProfileAction,
  updateClinicSettingsAction,
  disconnectIntegrationAction,
  createTreatmentAction,
  archiveTreatmentAction,
  createLocationAction,
  archiveLocationAction,
  logReviewSnapshotAction,
} from "./actions";
import {
  UserPlus,
  ShieldCheck,
  Trash2,
  Link as LinkIcon,
  Unplug,
  Plus,
  MapPin,
  Star,
} from "lucide-react";
import { listTreatments } from "@/server/queries/treatments";
import { listLocations } from "@/server/queries/locations";
import { listReviews } from "@/server/queries/reviews";

export const metadata = { title: "Einstellungen" };

export default async function EinstellungenPage() {
  const session = await requireSession();
  const isInhaber = session.role === "inhaber";

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);

  const team = isInhaber
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

  const credentials = isInhaber
    ? await db
        .select()
        .from(schema.platformCredentials)
        .where(eq(schema.platformCredentials.clinicId, session.clinicId))
    : [];

  const metaCred = credentials.find((c) => c.platform === "meta");
  const googleCred = credentials.find((c) => c.platform === "google");

  const isDetail = session.uiMode === "detail";
  const [treatments, locations, reviews, recentAudit] = await Promise.all([
    isDetail
      ? listTreatments(session.clinicId, session.userId)
      : Promise.resolve([] as Awaited<ReturnType<typeof listTreatments>>),
    isDetail
      ? listLocations(session.clinicId, session.userId)
      : Promise.resolve([] as Awaited<ReturnType<typeof listLocations>>),
    isDetail
      ? listReviews(session.clinicId, session.userId)
      : Promise.resolve([] as Awaited<ReturnType<typeof listReviews>>),
    isDetail
      ? db
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
          .limit(20)
      : Promise.resolve([] as never[]),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Einstellungen.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihr Profil, Ihr Team und Ihre Verbindungen zu Meta und Google.
        </p>
      </header>

      {/* My profile — everyone */}
      <Card>
        <CardHeader>
          <CardTitle>Mein Profil</CardTitle>
        </CardHeader>
        <CardContent>
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
            <div className="md:self-end">
              <Button type="submit">Speichern</Button>
            </div>
          </form>
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
            <span className="text-fg-secondary">Rolle:</span>
            <Badge tone="neutral">
              {ROLE_LABELS[session.role as Role] ?? session.role}
            </Badge>
            <span className="text-fg-secondary">Zwei-Faktor:</span>
            {session.mfaVerified ? (
              <Badge tone="good">Aktiv</Badge>
            ) : (
              <Badge tone="warn">Nicht aktiv</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Clinic settings — Inhaber only */}
      {isInhaber && clinic && (
        <Card>
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

      {/* Team — Inhaber only */}
      {isInhaber && can(session.role, "settings.team") && (
        <Card>
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
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg-primary">
                          {m.fullName ?? m.email}
                        </span>
                        {isSelf && (
                          <Badge tone="neutral">Sie</Badge>
                        )}
                        <Badge tone="neutral">
                          {ROLE_LABELS[m.role as Role] ?? m.role}
                        </Badge>
                        {m.mfaEnrolled ? (
                          <Badge tone="good">2FA aktiv</Badge>
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
                    {!isSelf && (
                      <div className="flex gap-2">
                        {m.mfaEnrolled && (
                          <form action={resetMemberMfaAction}>
                            <input
                              type="hidden"
                              name="userId"
                              value={m.id}
                            />
                            <Button
                              type="submit"
                              variant="outline"
                              size="sm"
                            >
                              <ShieldCheck className="h-4 w-4" />
                              2FA zurücksetzen
                            </Button>
                          </form>
                        )}
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
        <Card>
          <CardHeader>
            <CardTitle>Werbekonten verbinden</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <IntegrationRow
              platform="meta"
              label="Meta · Facebook & Instagram"
              connected={!!metaCred}
              accountId={metaCred?.accountId ?? null}
              lastSyncedAt={metaCred?.lastSyncedAt ?? null}
              available={hasMeta()}
            />
            <IntegrationRow
              platform="google"
              label="Google Ads"
              connected={!!googleCred}
              accountId={googleCred?.accountId ?? null}
              lastSyncedAt={googleCred?.lastSyncedAt ?? null}
              available={hasGoogle()}
            />
          </CardContent>
        </Card>
      )}

      {isDetail && (
        <>
          {/* Treatments CRUD */}
          {can(session.role, "settings.team") && (
            <Card>
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
                  className="grid gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4 md:grid-cols-[1fr_1fr_1.5fr_8rem_auto]"
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
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Recall (Monate)
                    </label>
                    <Input
                      name="defaultRecallMonths"
                      type="number"
                      min={0}
                      max={60}
                      placeholder="6"
                    />
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
                        {t.defaultRecallMonths != null && (
                          <Badge tone="neutral">
                            Recall: {t.defaultRecallMonths} Mon
                          </Badge>
                        )}
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
            <Card>
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

          {/* Review snapshots */}
          {can(session.role, "settings.team") && (
            <Card>
              <CardHeader>
                <CardTitle>Reputation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-fg-secondary">
                  Eine Momentaufnahme der Bewertungen pro Plattform manuell
                  erfassen. Wird im Dashboard und in der Auswertung angezeigt.
                </p>
                <form
                  action={logReviewSnapshotAction}
                  className="grid gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4 md:grid-cols-[10rem_8rem_8rem_1fr_auto]"
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Plattform
                    </label>
                    <select
                      name="platform"
                      defaultValue="google"
                      className="h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
                    >
                      <option value="google">Google</option>
                      <option value="jameda">Jameda</option>
                      <option value="trustpilot">Trustpilot</option>
                      <option value="manual">Eigene</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Bewertung (0–5)
                    </label>
                    <Input
                      name="rating"
                      type="number"
                      step="0.1"
                      min={0}
                      max={5}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Anzahl
                    </label>
                    <Input name="totalCount" type="number" min={0} required />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Notiz
                    </label>
                    <Input name="notes" maxLength={500} />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" className="w-full md:w-auto">
                      <Star className="h-4 w-4" />
                      Erfassen
                    </Button>
                  </div>
                </form>

                {reviews.length > 0 && (
                  <ul className="divide-y divide-border">
                    {reviews.slice(0, 8).map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <span>
                          <span className="font-medium capitalize text-fg-primary">
                            {r.platform}
                          </span>
                          <span className="ml-2 tabular-nums">
                            {r.rating.toFixed(1).replace(".", ",")} ★
                          </span>
                          <span className="ml-2 text-fg-secondary">
                            ({r.totalCount} Bewertungen)
                          </span>
                        </span>
                        <span className="text-xs text-fg-tertiary tabular-nums">
                          {formatDateTime(r.recordedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* Audit log preview */}
          {recentAudit.length > 0 && (
            <Card>
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
            <Card>
              <CardHeader>
                <CardTitle>Technische Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <span className="text-fg-secondary">Praxis-ID:</span>{" "}
                  <code className="font-mono">{clinic.id}</code>
                </div>
                <div>
                  <span className="text-fg-secondary">Plan:</span> {clinic.plan}
                </div>
                <div>
                  <span className="text-fg-secondary">Kunde seit:</span>{" "}
                  {formatDateTime(clinic.planStartedAt)}
                </div>
                <div>
                  <span className="text-fg-secondary">Ihr Nutzer-ID:</span>{" "}
                  <code className="font-mono">{session.userId}</code>
                </div>
              </CardContent>
            </Card>
          )}
        </>
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
  label: string;
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
