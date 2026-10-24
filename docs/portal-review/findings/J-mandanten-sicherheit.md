# Bereich J: Mandanten-Sicherheit (Server Actions, Routen, RLS, Fix-Runde)

Read-only Review von `apps/portal` und `apps/clinic-landing/app/r/**`. Es wurde keine Quelldatei geändert, kein Dev-Server gestartet, in keine Datenbank geschrieben. Die lokale Docker-DB (`eins-postgres`, DB `eins_portal`) wurde nur mit SELECT auf den Katalog abgefragt (`pg_class`, `pg_policies`, `pg_indexes`, `has_table_privilege`). Die Produktions-DB (Neon) war nicht erreichbar; was nur dort gilt, ist als Annahme markiert.

Zeilenangaben mit `~` sind auf wenige Zeilen genau. Dateien der anderen Sitzung (`wiederbehandlungen/**`, `retreatment*`, `worker/processors/pvs-*`, `api/pvs/**`, `server/pvs-*`, `lib/queues.ts`, `server/jobs.ts`, `worker/index.ts`, `worker/schedules.ts`) sind gelesen und mit `(andere Sitzung)` markiert.

Was bewusst nicht erneut gemeldet wird: alles, was in `findings/B-auth.md`, `F-break-client.md`, `G-break-admin.md` gefunden und in `fixes/WS*.md` korrekt behoben wurde, sowie TOTP/MFA. Wo eine Behebung unvollständig ist, steht das als eigener Befund.

## Gesamturteil in drei Sätzen

Die Mandantentrennung im Praxis-Portal ist im Kern solide: Jede Server Action und jede Session-Route leitet die Praxis aus der Session ab (`session.clinicId`), keine nimmt eine `clinicId` aus Client-Eingaben, Datei-Keys werden serverseitig erzeugt und beim Finalisieren gegen das eigene Präfix geprüft. Die einzige echte Mandantenlücke liegt außerhalb der Session-Pfade: die Zuordnung eingehender Meta-Leads zur Praxis über die Facebook-Seiten-ID ist nicht eindeutig (J-1). Danach folgen eine unvollständige Behebung aus der Fix-Runde (Audit-Zuordnung bei Impersonation, J-2) und Defense-in-Depth-Lücken bei RLS und DB-Rolle (J-3, J-7).

---

## Teil 1: Inventar aller Server Actions und Routen mit Kennung

Legende der Scoping-Mechanismen:

- **S** = `requireSession()` (`auth/guards.ts`, `auth/session.ts` ~191-321: Session-Hash, widerrufen, abgelaufen, Nutzer und Praxis nicht archiviert).
- **W** = `withClinicContext(clinicId, userId, fn)` (`db/client.ts:119-140`): App-Rolle `eins_app`, RLS-Variable `app.current_clinic_id` per `set_config(..., true)`.
- **P** = zusätzlich explizites `clinic_id`-Prädikat im Statement (Gürtel und Hosenträger zu RLS).
- **D** = Superuser-`db` (umgeht RLS) mit explizitem `clinic_id`- oder `user_id`-Prädikat aus der Session.
- **R** = serverseitige Rollenprüfung `can(session.role, "<recht>")` (`lib/roles.ts`).

### 1.1 Server Actions im Praxis-Portal

| Aktion (Datei:Zeile) | Kennung aus Client | Scoping | Rolle | Urteil |
|---|---|---|---|---|
| `anfragen/[id]/actions.ts`: logCall 116, addNote 261, changeStatus 314, scheduleFollowup 403, completeFollowup 517, cancelFollowup 521, revokeAdsConsent 534 | requestId, followupId | S+W+P | R `requests.update` (alle Rollen) | sauber |
| `dateien/actions.ts`: createClientUploadTargets 62 | nur Dateiname/Größe/Typ, Key serverseitig `server/uploads.ts:37` (`${clinicId}/uploads/<uuid>.<ext>`) | S | R `uploads.send` | sauber |
| `dateien/actions.ts`: finalizeClientUploads 113 | Storage-Key | S, Präfixprüfung `${session.clinicId}/uploads/` und `..` (Z. 134), `head`, Größe/Typ nachgeprüft und Übergröße gelöscht (Z. 145-159), Insert W mit `onConflictDoNothing` | R `uploads.send` | sauber |
| `dateien/actions.ts`: deleteClientUpload 198 | uploadId (uuid) | S+W+P, Storage-Key aus der eigenen Zeile | R `uploads.send` | sauber |
| `medien/actions.ts`: requestAnimationCustomization 24 | libraryId (uuid) | S+W, Upsert auf (clinic_id, library_id); `animation_library` ist global | R `animations.request_customization` | sauber |
| `einstellungen/actions.ts`: inviteTeamMember 68, resendInvite 196, removeTeamMember 266 | E-Mail, Rolle, userId | S+D+P (`clinicId = session.clinicId`) | R `settings.team` (nur inhaber); Rollenvergabe nur inhaber (Z. 89-92) | sauber, TOCTOU beim Letzter-Inhaber-Schutz siehe Randnotiz |
| `einstellungen/actions.ts`: updateOwnProfile 342 | keine Kennung (eigene userId) | S+D, `WHERE id = session.userId` | jede Rolle (nur eigenes Profil) | sauber |
| `einstellungen/actions.ts`: updateClinicSettings 378, createTreatment 487, archiveTreatment 540, createLocation 575, archiveLocation 617 | treatmentId, locationId | S+W+P | R `settings.team` | sauber |
| `einstellungen/actions.ts`: updateReviewSettings 690 | keine Kennung; URLs und Origin | S+W | R `settings.team` | Befund J-4 (URL-Validierung) |
| `einstellungen/actions.ts`: syncReviewsNow 818 | keine | S, Praxis aus Session; Jameda nur https und `jameda.de` (Z. 665-678, SSRF-Schutz) | R `reviews.manage` | sauber |
| `einstellungen/actions.ts`: disconnectIntegration 439 | Plattform | S+D+P | R `settings.integrations` | sauber |
| `einstellungen/actions.ts`: rotateIntakeSecret 891 | keine | S+D, Insert/Upsert mit `clinicId: session.clinicId`, Altsecret wird 24 h Grace (`previousValidUntil` per DB-`now()`) | R `settings.integrations` (nur inhaber) | sauber |
| `einstellungen/actions.ts`: updateAdsConversionConfig 982 | Pixel-/Customer-IDs (Regex-validiert) | S+W | R `settings.integrations` | sauber |
| `einstellungen/integrationen/actions.ts`: issueAgentEnrollment 51, listOpenAgentEnrollments 99, rotatePvsSecret 117 | keine | S, Praxis aus Session, Transaktion | R `settings.integrations` | sauber |
| `einstellungen/integrationen/actions.ts`: resolveLinkingFailure 165, ignoreLinkingFailure 226, mapTreatment 252, mapLocation 316 | failureId, treatmentId, locationId | S+D+P; Logik in `server/pvs-linking.ts:698-802` (andere Sitzung) mit clinicId-Prädikat | R `settings.integrations` | sauber |
| `einstellungen/sicherheit/actions.ts`: changePassword 52, logoutAllDevices 131 | keine (eigene userId) | S+D | jede Rolle, bei Impersonation serverseitig gesperrt (`auth/impersonation-guard.ts`) | sauber |
| `einstellungen/avatar-actions.ts`: uploadOwnAvatar 38, removeOwnAvatar 111 | keine; Key `avatars/<userId>.webp` serverseitig | S+D | jede Rolle (nur eigener Avatar) | sauber |
| `onboarding/checkliste/actions.ts`: saveChecklistItem 162, createChecklistUploadTarget 283, finalizeChecklistFile 325, removeChecklistFile 418 | itemId (gegen Katalog geprüft), Storage-Key, fileId | S+W+P, Key serverseitig, Präfixprüfung beim Finalisieren | R `onboarding.complete` (nur inhaber) | sauber |
| `onboarding/fragebogen/actions.ts`: saveDiscovery 56, reopenDiscovery 245 | keine | S+W+P | R `onboarding.complete` | sauber |
| `server/actions/pvs-csv-upload.ts`: uploadCsv 75, confirmCsvMapping 164, getCsvUploadStatus 246, listRecentCsvUploads 286 | uploadId, uploadGroupId (uuid) | S+D+P, Key serverseitig | R `settings.integrations` über `requireIntegrationsSession` | sauber |
| `bewertungen/feedback/actions.ts`: setFeedbackStatus 14, setFeedbackNote 66 | feedbackId | S+W+P | R `patient_feedback.manage` (inhaber, marketing) | sauber |
| `feedback/actions.ts`: submitFeedback 32 | keine | S+W | R `feedback.submit` | sauber |
| `dashboard/_components/anomaly-actions.ts`: dismissAlert 25, snoozeAlert 45 | alertId | S+W+P | alle Rollen (nur Hinweis ausblenden) | sauber |
| `hwg-check/actions.ts` 23, `leitfaden/pruefung/actions.ts` 43 | keine | S+W | R `tools.hwg_check`, `leitfaden.quiz` | sauber |
| `_components/tour/actions.ts` 20/45/69, `_components/nav-actions.ts` 14 | keine (eigene userId bzw. Bereich) | S+D | jede Rolle; Tour ist bei Impersonation ausgeblendet (`(portal)/layout.tsx:60,99`) | sauber |
| `wiederbehandlungen/actions.ts`: updateRetreatmentSettings 49, updateRetreatmentTreatments 105, dismiss 165, restore 195 (andere Sitzung) | treatmentId, retreatmentId | S+W+P | R `settings.team` bzw. `requests.update` | sauber (Lesestand) |
| `(auth)/login/actions.ts` 106/176/212, `(auth)/set-password/actions.ts` 48 | E-Mail, Passwort | vor der Session; Rate-Limit, neutrale Antworten | n/a | sauber (siehe B-auth) |

### 1.2 Server Actions im Admin-Portal (`/admin`, cross-tenant by design)

Alle 46 exportierten Actions in `admin/animations`, `admin/clinics`, `admin/clinics/[id]`, `admin/clinics/[id]/dsgvo`, `admin/garantie`, `admin/journey`, `admin/pvs-bridge/konfigurationen`, `admin/rueckruf`, `admin/videos` rufen `requireAdmin()` (Anzahl Exporte gleich Anzahl Guards je Datei; `rueckruf` über den gemeinsamen Helfer `record()` Z. 46-47). Die Admin-Login-/Set-Password-Actions laufen vor der Session. Kein Befund. Der Host-Schutz (`admin.*`) liegt in `middleware.ts:57-105`, die Admin-Session selbst in `auth/admin.ts` (inklusive IP-Allowlist).

### 1.3 Route Handler (`src/app/api/**`)

| Route (Datei) | Kennung | Authentifizierung und Scoping | Urteil |
|---|---|---|---|
| `requests` GET, `kpis` GET, `search/leads` GET, `notifications` GET (`server/api.ts` withApi) | Query-Parameter | Session + `permission` (`requests.view`, `reports.view`), Zugriff über `dbApp`/RLS und Prädikat; `notifications` per `user_id` | sauber |
| `notifications/read` POST | Notification-IDs | `withApiTx` (RLS-Rolle) + userId-Prädikat | sauber |
| `requests/export` GET (`:46-53`) | Filter | Session + `requests.view`, Query mit `session.clinicId`, CSV-Formelschutz (`csv.ts`, Regex `^[\t\r]*[=+\-@]`) | sauber |
| `files/[...path]`, `uploads` (lokaler Treiber) | Storage-Key | in Produktion und bei R2 hart 404 (`files:31`); sonst Session + Präfix `${clinicId}/` (`:46`) + Rollensichtbarkeit von Dokumenten (`:58-70`) + Symlink-Containment; `uploads` PUT nur mit Session/Admin | sauber |
| `admin/files/[...path]` | Storage-Key | `getAdminSession()` (Cookie hostgebunden), Audit je Download, SVG/Unbekanntes nur als Download mit Sandbox-CSP | sauber |
| `admin/clinics/[id]/dsgvo/export` | clinicId (uuid) | `requireAdminForApi()`, uuid-Prüfung, Existenzprüfung, Audit erst nach letztem Chunk | sauber (siehe 3.8) |
| `admin/pvs/*` (andere Sitzung) | eventId | `requireAdminForApi()` | sauber (Lesestand) |
| `auth/start-impersonation`, `auth/end-impersonation`, `auth/logout` | Einmal-Token | 60 s Einmal-Token, POST-Handoff, `impersonated_by_admin_id` in Session und Audit | sauber (siehe 3.4) |
| `auth/callback` GET/POST, `auth/google/*`, `integrations/{meta,google}/{start,callback}` | Magic-Link-Token, OAuth-State | siehe 3.1; OAuth-State ist ein JWT (`server/oauth.ts`, 10 min) mit Cookie-Doppelbindung und Prüfung `clinicId` + `userId` gegen die Session; Start verlangt `settings.integrations` | sauber |
| `leads/intake` POST | clinicId im Body | HMAC je Praxis (`server/clinic-signature.ts`, `timingSafeEqual`, Grace nur bis `previousValidUntil` serverseitig), erst danach Schreiben | sauber |
| `webhooks/meta/leadgen` | Seiten-ID `entry[].id` | HMAC `X-Hub-Signature-256` über Rohbody; Zuordnung Seite zu Praxis | **Befund J-1** |
| `webhooks/resend` | Resend-Event | Svix-HMAC, 5 min Toleranz, Rohbody, `timingSafeEqual` | sauber |
| `review-tokens/[token]` GET, `/click`, `/feedback`, `/unsubscribe` | 64-hex-Token | Token ist die Berechtigung (256 Bit, TTL 90 Tage), Rate-Limit pro IP | sauber, J-8 |
| `retreatment-tokens/[token]/book`, `/unsubscribe` (andere Sitzung) | Token | Token, Rate-Limit, GET ohne Zustandsänderung | sauber (Lesestand) |
| `public/videos/[slug]*`, `videos`, `videos/upload-target` | slug / Bearer | EINS-eigene Outreach-Videos, keine Mandantendaten; Bearer `VIDEO_API_TOKEN` mit `constantTimeEqual` | sauber |
| `cron/daily`, `cron/morning` | keine | Bearer `CRON_SECRET` | sauber (siehe 3.6) |
| `pvs/*` (andere Sitzung) | clinicId im Body | HMAC je Praxis oder Enrollment-Token | sauber (Lesestand) |
| `health`, `vitals`, `dev/email-preview` | keine | `health` ohne Daten (nur Booleans und feste Codes), `vitals` per-Isolate-Limit, `dev/email-preview` in Produktion 404 (`:28`) | sauber |

### 1.4 Superuser-`db` auf Portal-Pfaden

Die Superuser-Verbindung (`db`, umgeht RLS) wird im Praxis-Portal in diesen Gruppen genutzt. Bei allen geprüften Stellen stammt die Praxis aus der Session (`session.clinicId`) oder aus einem geheimen Token, nie aus einer Client-Kennung:

1. Authentifizierung und Sessions: `auth/session.ts`, `auth/magic-link.ts`, `auth/password.ts`, `auth/user-lookup.ts`, `auth/impersonation.ts` (vor der Session oder bewusst mandantenübergreifend).
2. Audit: `server/audit.ts` (`writeAudit`, nur INSERT).
3. Einstellungen und Integrationen: `einstellungen/actions.ts` (13 Stellen), `integrationen/actions.ts` (6), `einstellungen/avatar-actions.ts`, `sicherheit/actions.ts`, `tour/actions.ts`; alle mit `clinicId = session.clinicId` oder `id = session.userId`.
4. Seiten-Reads: `onboarding/page.tsx`, `einstellungen/page.tsx`, `integrationen/*/page.tsx`, `anfragen/[id]/page.tsx:93-112`, `werbebudget`, `bewertungen`, `feedback`; `server/queries/clinic.ts:72` und `forecast.ts:190/257/319` mit `clinic_id = ${clinicId}`.
5. Token- und Signaturpfade ohne Session: `server/review-tokens.ts`, `server/retreatment-tokens.ts` (andere Sitzung), `server/leads.ts`, `webhooks/*`, `cron/*`.
6. PVS (andere Sitzung): `server/pvs-*`, `worker/processors/pvs-*`.
7. Admin: `server/queries/admin*.ts` (cross-tenant by design).

Lücken in dieser Liste: ich habe die 48 Treffer unter `app/(portal)` und die `server/queries/*`-Dateien gruppenweise und stichprobenartig gegengelesen, nicht jede Zeile von `server/queries/admin.ts` (nur über `requireAdmin`-Seiten erreichbar).

Randnotiz (P3, ohne eigenen Befund): Der Letzter-Inhaber-Schutz (`einstellungen/actions.ts:296-310`) zählt aktive Inhaber und archiviert danach in einem getrennten Statement. Zwei Inhaber, die sich im selben Moment gegenseitig entfernen, könnten beide die Prüfung bestehen. Folge: Praxis ohne Inhaber, wiederherstellbar durch Admin. Fix wäre `SELECT ... FOR UPDATE` in einer Transaktion.

---

## Teil 2: RLS-Abdeckung und DB-Rolle

### 2.1 Wie die App-Rolle gewählt wird

`db/client.ts:55-90`: `appClient()` wirft in Produktion, wenn `DATABASE_URL_APP` fehlt (`:59-63`) oder identisch mit `DATABASE_URL` ist (`:65-77`). Es gibt in Produktion also keinen stillen Fallback auf den Superuser. Die Rolle selbst wird nur in `assertAppRoleIsRlsSubject()` (`:167-190`) geprüft, und die wird nur vom Health-Check aufgerufen (`api/health/route.ts:86-93`). Das ist Befund J-7.

### 2.2 Tabellen ohne RLS oder ohne Policy (lokaler Katalog, Stand heute)

Lokal mit `has_table_privilege('eins_app', ...)`; die Docker-Init vergibt per `ALTER DEFAULT PRIVILEGES` automatisch alle DML-Rechte an `eins_app` (`docker/postgres/init/01-extensions.sql:19-22`). In Neon sind die Rechte Sache der manuell ausgeführten Grants und Migrationen, der Stand dort ist von hier nicht prüfbar.

| Tabelle | RLS | Policies | `eins_app` lokal | Nutzung über App-Rolle? | Praxis-Funktion nötig? | Empfehlung |
|---|---|---|---|---|---|---|
| `guarantee_clocks`, `guarantee_delays`, `guarantee_candidate_rejections` | an | 0 | keine Rechte | nein, nur `db` und Admin | nein (EINS-intern, Migration 0075) | Zustand ist richtig (Deny-by-default, harter Fehler "permission denied"). Kein Befund |
| `response_enforcement_events` | an | 0 | keine Rechte | nein, nur `db` und Admin | nein (Migration 0076) | wie oben, kein Befund |
| `email_send_log` | aus | 0 | keine Rechte (REVOKE in 0083) | nein | nein | REVOKE reicht, kein Befund |
| `worker_heartbeat`, `ops_alert_log`, `rate_limits`, `admin_*`, `impersonation_tokens` | aus | 0 | keine Rechte | nein | nein | Zustand richtig, kein Befund |
| **`clinic_notices`** | aus | 0 | **SELECT/INSERT/UPDATE/DELETE** | nein (`server/clinic-notices.ts` nur über `db` aus Admin-Actions) | nein, keine Praxis-Seite liest sie | **J-3: RLS an und REVOKE** |
| **`email_suppression`** | aus | 0 | **volle DML** | nein (alle Zugriffe `db`: `email-suppression.ts:38`, `patient-events.ts:80,195`, `review-tokens.ts:272`, `webhooks/resend/route.ts:152`) | nein, es gibt keine Praxis-Oberfläche (der Kommentar in `0013_eins_stimme.sql:163-168` verspricht eine) | **J-3: RLS mit Tenant-Policy, Schreibrechte entziehen** |
| `sessions`, `magic_links` | aus | 0 | volle DML | nein, nur `db` | nein | J-9 (P3) |
| `schema_migrations`, `geocode_cache`, `timeline_default_steps`, `outreach_videos`, `outreach_video_events` | aus | 0 | volle DML | nein; keine Mandantendaten | nein | J-9 (P3) |
| `pvs_agent_failure_summary`, `pvs_agent_status`, `pvs_link_audit`, `pvs_reconcile_audit`, `pvs_vendor_config_target` (andere Sitzung) | aus | 0 | volle DML, haben `clinic_id` | `pvs_link_audit` wird per `tx.insert` in `server/pvs-agent-enroll.ts:318,334` und `pvs-link-state.ts:88` geschrieben (ob `tx` die App-Rolle ist, nicht abschließend geprüft) | Teilweise (Anzeige in Integrationen) | (andere Sitzung) Tenant-Policy nachziehen, siehe 2.4 |
| `pvs_event_log_2026_04` bis `_12` (Partitionen) (andere Sitzung) | aus (Parent hat RLS) | 0 | volle DML | nein direkt | nein | (andere Sitzung) Direktzugriff auf eine Partition umgeht die Policy des Parents; Rechte auf Partitionen entziehen oder Policy je Partition |
| `audit_log` | an + FORCE | 2 (SELECT, INSERT) | volle DML-Rechte, aber nur SELECT und INSERT per Policy | ja | ja | Append-only für die App-Rolle, richtig. Hinweis: `SELECT` zeigt auch Zeilen mit `clinic_id IS NULL` (`audit_log_read_scoped`), aktuell liest sie kein Portal-Pfad |
| `platform_credentials`, `clinic_users` | an + FORCE | Tenant-Policy | volle DML | ja | ja | richtig (`platform_credentials_bridge` nur SELECT für `eins_bridge`, `platform = 'pvs'`) |

### 2.3 Empfohlene Migration (nächste freie Nummer, `0088` ist frei, Stand der Migrationsliste `0087_request_notified.sql`)

Muster wie in `0075`/`0076`/`0083` (REVOKE nur, wenn die Rolle existiert). `email_suppression` bekommt eine Tenant-Policy, damit eine künftige Praxis-Ansicht sicher wird, aber keine Schreibrechte:

```sql
-- 0088_rls_clinic_notices_email_suppression.sql
ALTER TABLE clinic_notices ENABLE ROW LEVEL SECURITY;       -- ohne Policy: Deny-by-default
ALTER TABLE email_suppression ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_suppression_tenant ON email_suppression;
CREATE POLICY email_suppression_tenant ON email_suppression
  FOR SELECT
  USING (clinic_id = app_current_clinic());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    REVOKE ALL ON clinic_notices FROM eins_app;
    REVOKE INSERT, UPDATE, DELETE ON email_suppression FROM eins_app;
  END IF;
END $$;
```

Wichtig: Bewusst nur `ENABLE`, kein `FORCE`. `db` ist Tabelleneigentümer bzw. Superuser/`bypassrls` (lokal `eins`, in Neon `neondb_owner`), alle heutigen Zugriffe laufen darüber, auch die öffentlichen Abmelde-Pfade ohne `app_current_clinic()`, und bleiben unverändert. Mit `FORCE` würde ein Eigentümer ohne `bypassrls` an der Policy scheitern.

Für Neon vor dem Deploy dieser Migration als Nur-Lese-Abfrage gegen die echte DB laufen lassen:

```sql
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('eins_app', c.oid, 'SELECT') AS sel,
       has_table_privilege('eins_app', c.oid, 'INSERT') AS ins,
       has_table_privilege('eins_app', c.oid, 'UPDATE') AS upd,
       has_table_privilege('eins_app', c.oid, 'DELETE') AS del
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
  AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname))
ORDER BY 2, 1;

-- und gegen DATABASE_URL_APP (die Verbindung der App selbst):
SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

### 2.4 pvs_* (andere Sitzung)

Wenn die andere Sitzung RLS für `pvs_agent_failure_summary`, `pvs_agent_status`, `pvs_link_audit`, `pvs_reconcile_audit`, `pvs_vendor_config_target` nachzieht: `USING (clinic_id = app_current_clinic()) WITH CHECK (clinic_id = app_current_clinic())` plus Ausnahmepolicy für die Rolle, die Agenten-Routen verwenden (`eins_bridge` nach Muster `platform_credentials_bridge`). Nicht von mir umzusetzen, hier nur dokumentiert.

---

## Teil 3: Unabhängige Prüfung der Fix-Runde

| # | Punkt | Ergebnis | Beleg |
|---|---|---|---|
| 1 | Magic-Link GET zu POST | sauber, plus Randfall J-6 | GET `/api/auth/callback` leitet nur per 303 auf `/login/link` (`api/auth/callback/route.ts:41-50`), verbraucht nie. `/login/link` ruft nur `peekMagicLink` (lesend, `login/link/page.tsx:91-95`), Metadata `referrer: no-referrer` (`:23`) und Header `Referrer-Policy: no-referrer` auf der Weiterleitung. POST prüft Cross-Site (`isCrossSiteRequest`, Sec-Fetch-Site und Origin) vor dem Einlösen (`route.ts:52-55`). Einlösen per bedingtem `UPDATE ... RETURNING` (race-sicher, Wiederholung scheitert). Token steht in der URL und damit in den Vercel-Zugriffslogs: 15 min gültig, einmalig, nur Karam liest Logs: akzeptabel |
| 2 | Session-Prüfreihenfolge, Archiv-Sperre | sauber | `getSession` holt Session, Nutzer und Praxis in einer Abfrage (`auth/session.ts` ~191-321) und entscheidet über `sessionRejectReason` (`auth/session-validity.ts`): widerrufen, abgelaufen, Nutzer archiviert, Praxis archiviert, Impersonations-Admin ohne gültige Admin-Session. Archivierte Nutzer und Praxen sind ab der nächsten Anfrage ausgesperrt |
| 3 | Intake-Secret-Rotation, 24 h Grace | sauber | nur `settings.integrations` (nur inhaber, `einstellungen/actions.ts:897`). Verifikation: HMAC-SHA256, `timingSafeEqual`, Längenprüfung (`server/clinic-signature.ts:116-123`). Grace wird serverseitig mit `previousValidUntil > Date.now()` erzwungen (`:95-103`), Ablauf per DB-`now() + 24 h` gesetzt (`actions.ts:920`). Zweimal rotieren löscht das Altsecret endgültig, das ist ein Plus. Cache-Invalidierung vorhanden |
| 4 | Impersonation 30 min | sauber | `sessionMaxAgeSeconds`/`sessionRejectReason` kürzen Impersonations-Sessions auf 30 min, sowohl im JWT-`exp` als auch in `sessions.expires_at`, also serverseitig. Passwort ändern, Login-E-Mail ändern, Alle-Geräte-abmelden sind in `auth/impersonation-guard.ts` gesperrt. Schreibzugriffe sind erlaubt (Entscheidung des Inhabers), tragen `impersonatedByAdminId` in `sessions` und `audit_log` (Migration 0082), mit einer Ausnahme: **J-2**. Einmal-Token 60 s, POST-Handoff |
| 5 | Admin-IP-Allowlist | sauber, Annahme | CIDR-Auswertung in `auth/ip-allowlist.ts`. IP aus `lib/client-ip.ts`: `x-real-ip` zuerst, sonst der rechteste XFF-Eintrag (nicht der clientseitig setzbare linke). Annahme: auf Vercel setzt die Plattform `x-real-ip` und überschreibt `x-forwarded-for`. Läuft das Portal je hinter einem anderen Proxy, muss `trustedIpFromHeaders` neu bewertet werden |
| 6 | Cron-Routen | sauber | `api/cron/_lib/run.ts:17-31`: `CRON_SECRET` ungesetzt gibt 503 (geschlossen), sonst SHA-256 beider Seiten und `timingSafeEqual` (längenunabhängig). Daily und Morning sind GET (Vercel-Cron). Idempotenz über `server/email-once.ts` (Ledger-Schlüssel) und den atomaren Claim `UPDATE ... WHERE status='pending' RETURNING` in `worker/processors/review-request.ts` (Z. 235-246), also kein Doppelversand bei Cron plus Worker |
| 7 | CSV-Export | sauber | Session und `requests.view` (`api/requests/export/route.ts:46-53`), Abfrage mit `session.clinicId`, Formelschutz in `csv.ts` (Präfix `'` bei `=`, `+`, `-`, `@`, Tab, CR) mit Test. Nebenwirkung: `+49...`-Telefonnummern erhalten ein sichtbares `'`, ist Absicht und nur Komfort |
| 8 | DSGVO-Export/Löschung | sauber, plus J-5 | Export: `requireAdminForApi()` (`dsgvo/export/route.ts:25`), uuid-Prüfung, Existenzprüfung, Secrets geschwärzt (`server/dsgvo.ts:34`, Spalten `_enc`, `_hash`, `token`, `secret`, `raw_payload`), Audit nach letztem Chunk. Admin-Cookie ist `__Host-`-gebunden und fehlt auf dem Praxis-Host, also 401 dort. Löschen: `requireAdmin()`, Slug-Bestätigung gegen den aus der DB geladenen Slug der Ziel-ID (`dsgvo/actions.ts:33-42`), eine Transaktion inklusive Audit (`server/dsgvo.ts:201-251`). Die Tabellenliste kommt aus dem Katalog. Die `sql.raw`-Interpolation der `clinicId` (`:86`, `:214`) ist durch die uuid-Prüfung an beiden Eingängen abgesichert |
| 9 | Webhooks | sauber, J-1 für die Zuordnung | Resend: Svix, 5 min Toleranz, Rohbody (`webhooks/resend/route.ts:66,186`). Meta: `X-Hub-Signature-256` über den Rohbody, `timingSafeEqual` (`leadgen/route.ts:112-116,394`). Meta-Schema hat keinen Zeitstempel: Replay wird durch Rate-Limit je Praxis (`:195-204`) und Unique-Index `(clinic_id, meta_lead_id)` begrenzt |
| 10 | Bewertungs-Token und Abmeldung | sauber, J-4/J-8 | Token: 32 Byte `randomBytes` (`server/patient-events.ts:23,142`), TTL 90 Tage (`:29`), Ablaufprüfung `review-tokens.ts:89` (Abmeldung bewusst auch nach Ablauf). GET ändert bei der Abmeldung nichts: Portal-GET leitet per 303 auf die Bestätigungsseite (`api/review-tokens/[token]/unsubscribe/route.ts:79-98`), die Landing-Seite zeigt einen Button, der Server-Action `confirmUnsubscribe` auslöst (`clinic-landing/app/r/unsubscribe/page.tsx`, `actions.ts`). Der Rating-Klick (`/r/<token>?rating=N`) schreibt beim GET `rating_value`: nach Entwurf (E-31, letzter Klick gewinnt, nach Feedback endgültig), kein Sicherheitsproblem, nur Zähler. `/go` erlaubt nur https und Hosts `google.com`, `g.page`, `maps.app.goo.gl`, `goo.gl`, `jameda.de` (`go/route.ts:15-39`); die Landing-Seite rendert ausschließlich interne `/r/<token>/go`-Links (`page.tsx:94-106`), kein XSS-Pfad für Praxis-URLs. Feedback ist idempotent (Unique-Index 0032, `review-tokens.ts:289-329`) und für Abgemeldete gesperrt (`:269-285`). Referrer: `strict-origin-when-cross-origin` auf der Landing-Seite (`next.config.mjs:21`), das Token wandert nicht zu Google. Retreatment-Abmeldung: GET zeigt Seite mit Button, POST meldet ab (andere Sitzung, Lesestand ohne Befund) |

---

## Befunde

### J-1: Meta-Leads werden über eine nicht eindeutige Seiten-ID einer Praxis zugeordnet, Leads können bei der falschen Praxis landen
- Schwere: P1
- Art: security
- Sicherheit: hoch
- Ort: `src/db/migrations/0033_meta_leadgen.sql:32-34`, `src/server/meta-pages.ts:46-56` (`data?.[0]`) und `:76-95` (`findCredentialByMetaPageId`, `.limit(1)` ohne ORDER BY), `src/app/api/webhooks/meta/leadgen/route.ts:181` (`ingestOne`)
- Beleg: `platform_credentials_meta_page_idx` ist ein normaler, kein UNIQUE-Index (lokal bestätigt: nur `platform_credentials_pkey` und `platform_credentials_unique (clinic_id, platform)` sind eindeutig). `discoverAndStoreMetaPage` nimmt blind die erste Seite aus `/me/accounts` (`const page = body.data?.[0]`, Kommentar "V1: clinics have one"). `findCredentialByMetaPageId` holt `WHERE platform='meta' AND meta_page_id = $1 LIMIT 1`. Es gibt weder eine Eindeutigkeitsprüfung beim Speichern noch eine Prüfung beim Empfang, ob die Seite zu mehr als einer Praxis gehört. `ingestOne` speichert den Lead unter der gefundenen `clinicId` (`persistLead(cred.clinicId, ...)`), also mit Name, Telefon, E-Mail und Behandlungswunsch des Patienten.
- Szenario: EINS ist eine Agentur. Verbindet Karam (oder ein Freelancer, der mehrere Praxen betreut) die Meta-Anbindung für Praxis A und Praxis B mit demselben Facebook-Nutzer, der beide Seiten verwaltet, liefert `/me/accounts` dieselbe erste Seite für beide: beide Zeilen tragen dieselbe `meta_page_id`. Jede Anfrage dieser Seite landet danach bei der Praxis, die der Planer zuerst findet, und das ist nicht vorhersagbar. Eine Patientenanfrage mit Gesundheitsbezug liegt dann im Portal einer fremden Praxis (Art. 9 DSGVO). Dasselbe passiert, wenn der Inhaber von Praxis B eine Seite wählt, die schon an Praxis A hängt (Mitverwalter, ehemaliger Agenturzugang). Auffällig wird es erst, wenn eine Praxis "ihre" Leads vermisst. Heute nicht live (keine Integration eingerichtet), aber das ist genau der Weg, auf dem die erste Praxis mit Meta-Anzeigen startet.
- Fix-Vorschlag: (1) Migration: `CREATE UNIQUE INDEX platform_credentials_meta_page_uniq ON platform_credentials (meta_page_id) WHERE meta_page_id IS NOT NULL;` (vorher auf Duplikate prüfen). (2) In `discoverAndStoreMetaPage` die Seite nicht mit `data[0]` wählen: bei genau einer Seite diese nehmen, bei mehreren eine Auswahl verlangen oder mit klarer Fehlermeldung abbrechen; beim Speichern den Unique-Verstoß abfangen und "Diese Seite ist bereits mit einer anderen Praxis verbunden" melden (kein Überschreiben fremder Bindungen). (3) In `findCredentialByMetaPageId` mehr als eine Zeile als Fehler behandeln (nicht zuordnen, 500 plus Alarm), damit auch bestehende Altdaten nicht stillschweigend fehlleiten.

### J-2: Audit-Eintrag "Anfrage angesehen" trägt bei Impersonation keinen Admin und keine IP (Übergabe aus WS6 nicht umgesetzt)
- Schwere: P1
- Art: security
- Sicherheit: mittel
- Ort: `src/app/(portal)/anfragen/[id]/page.tsx:131-143`, Auflösung in `src/server/audit.ts:54-68`
- Beleg: `after(() => writeAudit({ clinicId, actorId: session.userId, action: "view", entityKind: "request", entityId: id, requestMeta: {} }))`. Es fehlt `impersonatedByAdminId`. `resolveImpersonatingAdminId` liefert bei übergebenem `requestMeta` ohne explizite ID absichtlich `null` (`audit.ts:61`: `if (input.requestMeta) return null;`). `requestMeta: {}` setzt außerdem IP und User-Agent auf null. `fixes/WS6.md` hatte an WS2 übergeben, hier `impersonatedByAdminId: session.impersonatedByAdminId` zu ergänzen; grep über `app/(portal)` findet die Eigenschaft nur in Layout und Einstellungsseite, nicht hier. Das ist die einzige Stelle mit `requestMeta` im Session-Pfad.
- Szenario: Karam öffnet im Namen einer Praxis (Impersonation, nur so sieht er Patientenanfragen) Anfragen, um dem Team zu helfen. Der Lese-Nachweis (DSGVO Art. 30/32, Pentest L2) steht danach im Audit-Log der Praxis als Aktion des Praxis-Nutzers, nicht als Zugriff von EINS. Das Praxis-Audit in den Einstellungen markiert Impersonation nur dort, wo `impersonated_by_admin_id` gesetzt ist (`einstellungen/page.tsx:918`), hier also nicht. Ein Praxis-Mitarbeiter wird für einen Lesezugriff verantwortlich gemacht, den EINS ausgeführt hat; bei einem Datenschutzvorfall fehlt der verlässliche Beleg, wer die Patientenakte geöffnet hat.
- Fix-Vorschlag: In `page.tsx` `impersonatedByAdminId: session.impersonatedByAdminId` übergeben und `requestMeta: { ip, ua }` aus den vor dem `after()` gelesenen Headern füllen (Header vor dem `after()` per `headers()` lesen). Dazu ein Test, der prüft, dass bei Impersonation die Admin-ID im Audit-Eintrag steht.

### J-3: `clinic_notices` und `email_suppression` haben kein RLS, und die App-Rolle darf beide vollständig lesen und schreiben
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/db/migrations/0086_admin_notices_invoice.sql:19` (Tabelle ohne RLS, ohne REVOKE), `src/db/migrations/0013_eins_stimme.sql:148-168` (RLS bewusst aus), `docker/postgres/init/01-extensions.sql:19-22` (Standardrechte)
- Beleg: Lokal bestätigt: beide Tabellen `rls = f`, 0 Policies, `has_table_privilege('eins_app', ..., 'SELECT'|'INSERT'|'UPDATE'|'DELETE')` jeweils true. Kein Portal-Pfad greift mit der App-Rolle darauf zu: alle Zugriffe laufen über `db` (`server/clinic-notices.ts:91,117` aus Admin-Actions, `server/email-suppression.ts:38`, `patient-events.ts:80,195`, `review-tokens.ts:272`, `webhooks/resend/route.ts:152`). `email_suppression.email` enthält Patienten-E-Mail-Adressen aller Praxen, `clinic_notices` den Wortlaut der förmlichen Hinweise (Verzug, Warnung) an Praxen. Die vier Tabellen mit RLS ohne Policy (`guarantee_*`, `response_enforcement_events`) sind dagegen richtig abgesichert (keine Rechte, Deny-by-default).
- Szenario: Heute kein Zugriff, daher kein akuter Leck. Aber das Muster ist riskant: Der Kommentar in `0013` kündigt eine Praxis-Einstellungsseite an, die `email_suppression` über `withClinicContext` und "explizites Filtern" liest. Die erste Abfrage ohne Prädikat zeigt dann E-Mail-Adressen fremder Praxen, weil RLS nichts abfängt. Genauso kann jeder künftige SQL-Fehler in einer App-Rolle-Abfrage `clinic_notices` aller Praxen lesen oder verändern.
- Fix-Vorschlag: Migration aus 2.3 (RLS an, `clinic_notices` ohne Rechte, `email_suppression` mit SELECT-Tenant-Policy und ohne Schreibrechte). Prod-Rechte vorher mit der Abfrage aus 2.3 prüfen, denn dort hängt der Stand von den manuellen Grants ab.

### J-4: Review-Einstellungen akzeptieren jede URL, und die Praxis bestimmt den Host der Links in EINS-Mails
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/app/(portal)/einstellungen/actions.ts:656-659` (`ReviewUrlSchema = z.string().url()`), `:708-710` und `:754-756` (Speichern), `src/worker/processors/review-request.ts:210` (`landingOrigin = row.reviewLandingOrigin ?? env.CLINIC_LANDING_ORIGIN`) und `:231` (Link in der Mail), `src/app/api/review-tokens/[token]/unsubscribe/route.ts:87-97` (303 auf diesen Origin), `src/server/review-tokens.ts:106-122` (`resolveGoogleReviewTarget`), `apps/clinic-landing/app/r/[token]/go/route.ts:15-39`
- Beleg: `reviewLandingOrigin` ist ein beliebiger Wert, der `z.string().url()` besteht (jedes Schema, jeder Host). Die Mail an Patienten verlinkt `${landingOrigin}/r/${token}` und alle fünf Sternlinks darauf. Der GET der Abmelde-URL leitet per 303 auf `${origin}/r/unsubscribe?token=...`. Der Audit-Eintrag (Pentest L11, `actions.ts:779-787`) macht die Änderung nachvollziehbar, verhindert sie aber nicht. Beim Google-Link schützt nur die Host-Allowlist im Landing-`/go`: sie erlaubt `*.google.com`, also auch `sites.google.com`, `docs.google.com`, `script.google.com`, Hosts, auf denen jeder Seiten oder Formulare veröffentlichen kann. `resolveGoogleReviewTarget` lässt bei fehlender Place-ID jede URL durch, die `writereview`, `/review` oder `g.page` enthält.
- Szenario: Das Konto einer Inhaberin wird übernommen (Passwort-Phishing, kein TOTP laut Entscheidung). Der Angreifer setzt `reviewLandingOrigin` auf eine eigene Domain. Die nächsten Bewertungs-Erinnerungen an echte Patienten kommen von der EINS-Absenderdomain (SPF/DKIM gültig), tragen den echten Praxisnamen und einen gültigen Token, und der Link führt auf die Seite des Angreifers. Dort lässt sich ein Formular zur Abfrage von Daten ("Bestätigen Sie Ihre Termin-E-Mail") oder ein Schadlink einblenden. Mandantenübergreifend ist das nicht, es betrifft die Patienten der eigenen Praxis, aber mit EINS-Absender.
- Fix-Vorschlag: `reviewLandingOrigin` aus dem Portal-Formular entfernen oder nur gegen eine feste Allowlist zulassen (zum Beispiel Umgebungsvariable `CLINIC_LANDING_ORIGINS`, kommagetrennt, Prüfung beim Speichern und beim Versand in `review-request.ts` und im Unsubscribe-GET). `googleReviewUrl` und `jamedaReviewUrl` beim Speichern mit derselben Prüfung wie `isAllowedReviewTarget` validieren (https, feste Hosts) und für Google auf `search.google.com`, `g.page`, `maps.app.goo.gl`, `www.google.com/maps` einengen statt `*.google.com`.

### J-5: DSGVO-Löschung entfernt nur Dateien, die in der DB stehen, nicht angefangene oder verwaiste Uploads
- Schwere: P2
- Art: data-correctness
- Sicherheit: niedrig
- Ort: `src/server/dsgvo.ts:128-165` (`collectClinicStorageKeys`), `:253-265`, `src/server/storage.ts:27-62` (Interface ohne `list` oder `removePrefix`), `src/server/uploads.ts:37`
- Beleg: Die zu löschenden Schlüssel werden aus sieben Tabellen gesammelt (`assets`, `documents`, `checklist_files`, `client_uploads`, `animation_instances`, `clinic_users.avatar_key`, `pvs_csv_uploads`). Uploads laufen als presigned PUT (`createUploadTarget`, Key `${clinicId}/<scope>/<uuid>.<ext>`), die DB-Zeile entsteht erst beim Finalisieren. Wird der Browser nach dem PUT geschlossen, die Finalisierung scheitert oder der Nutzer bricht ab, bleibt das Objekt ohne DB-Zeile in R2. Die Storage-Schnittstelle kann nur einzelne Schlüssel löschen, nicht nach Präfix.
- Szenario: Eine Praxis lädt ein Foto mit Patientendaten hoch, der Tab schließt sich vor dem Finalisieren. Später verlangt die Praxis Löschung nach Art. 17 oder der Vertrag endet. `eraseClinicData` meldet "gelöscht, dazu N Dateien aus dem Speicher", das Objekt liegt weiter in R2 unter `<clinicId>/uploads/...`. Der Nachweis der Löschung ist unvollständig.
- Fix-Vorschlag: `Storage` um `removePrefix(prefix)` erweitern (R2: ListObjectsV2 plus DeleteObjects, lokal: rekursives Löschen) und nach der Schlüsselschleife `removePrefix(`${clinicId}/`)` aufrufen; Ergebnis in das zweite Audit-Event schreiben. Zusätzlich optional eine R2-Lifecycle-Regel für nicht finalisierte Uploads.

### J-6: Doppelklick auf "Jetzt anmelden" verbrennt den Magic-Link, die Person landet auf einer Fehlerseite
- Schwere: P2
- Art: ux-flow
- Sicherheit: niedrig
- Ort: `src/app/(auth)/login/link/page.tsx:127-132` (Formular), `src/app/api/auth/callback/route.ts:55-` (POST)
- Beleg: Der Button ist ein einfaches `<form method="post" action="/api/auth/callback">` ohne Sperre gegen Mehrfachabsenden. Das Einlösen ist einmalig (richtig), die zweite Anfrage scheitert deshalb mit `consumed` und leitet auf `/login?error=...`.
- Szenario: Die Inhaberin (40-65, am Handy) tippt zweimal auf "Jetzt anmelden". Die erste Anfrage löst den Link ein, die zweite bricht die Navigation der ersten ab (Cookie der ersten Antwort wird oft verworfen), und die zweite meldet "Link schon verwendet". Sie muss einen neuen Link anfordern, bei einer Einladung heißt das Support-Kontakt. Das war der ursprüngliche Schmerz aus B-1, nur mit anderer Ursache.
- Fix-Vorschlag: Kleine Client-Komponente für den Button, die beim ersten Absenden `disabled` setzt (`useFormStatus` oder `onSubmit`). Alternativ eine kurze Toleranz im Server: Eine zweite Einlösung desselben Tokens innerhalb weniger Sekunden mit derselben Client-IP und demselben User-Agent führt auf dieselbe Weiterleitung, ohne eine zweite Session zu erzeugen. Die einfache Variante reicht.

### J-7: Die Prüfung, dass die App-DB-Rolle RLS-Subjekt ist, läuft nur im Health-Check, nicht vor dem ersten Mandantenzugriff
- Schwere: P3
- Art: security
- Sicherheit: niedrig
- Ort: `src/db/client.ts:55-90` (Guards), `:167-190` (`assertAppRoleIsRlsSubject`), `src/app/api/health/route.ts:86-93` und `:146` (`ok = every check === "ok"`)
- Beleg: Der Produktions-Guard vergleicht nur Strings: `DATABASE_URL_APP` darf nicht fehlen und nicht gleich `DATABASE_URL` sein (`:59-77`). Zeigt `DATABASE_URL_APP` auf eine andere URL derselben privilegierten Rolle (zum Beispiel die Pooler-Variante von `neondb_owner` neben der direkten URL), besteht der Guard. Die Katalogprüfung auf `rolsuper`/`rolbypassrls` läuft nur im Health-Check (in Produktion, memoisiert) und lässt die Sonde dort mit 503 fehlschlagen. Die Anfragepfade (`withClinicContext`, `withApiTx`, `dbApp`) rufen sie nicht auf.
- Szenario: Beim Deployment wird `DATABASE_URL_APP` mit dem Pooler-DSN des Eigentümers belegt. Die App läuft, alle Seiten funktionieren, RLS ist stillschweigend wirkungslos (`neondb_owner` hat `bypassrls`). Es bleibt nur das explizite `clinic_id`-Prädikat im Anwendungscode, genau das, was RLS als zweite Schicht absichern soll. Erkannt wird es nur, wenn jemand oder etwas `/api/health` nach dem Deploy auswertet. Ob ein Deploy-Gate oder Monitor existiert, ist aus dem Repository nicht ersichtlich. Wegen der expliziten Prädikate in den Actions (Teil 1) ist die Auswirkung begrenzt, deshalb nur P3.
- Fix-Vorschlag: In `withClinicContext` und `withApiTx` vor der ersten Transaktion einmal pro Prozess `await assertAppRoleIsRlsSubject()` aufrufen (memoisiert, danach kostenlos) und in Produktion bei Fehlschlag mit 500 abbrechen. In die Deploy-Checkliste die zweite Abfrage aus 2.3 gegen `DATABASE_URL_APP` aufnehmen.

### J-8: Rate-Limit der Bewertungs-Token-API zählt die Server-IP der Landing-Seite statt der des Patienten
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `apps/clinic-landing/lib/portal-review-tokens.ts:57-122` (reicht keine Client-IP weiter), `src/app/api/review-tokens/[token]/route.ts:31-45`, `.../click/route.ts:43-57`, `.../feedback/route.ts:40-57`
- Beleg: Patient besucht `clinic-landing`, deren Server ruft die Portal-API per `fetch`. Das Portal bildet den Rate-Limit-Schlüssel aus `trustedIpFromHeaders(x-forwarded-for, x-real-ip)` dieses Aufrufs, also aus der Egress-Adresse der Landing-Funktion (10 Feedbacks, 30 Klicks, 60 Abrufe je Minute und IP). Es gibt keine Weitergabe der Besucher-IP.
- Szenario: Ein Angreifer ruft in einer Schleife beliebige `https://<landing>/r/<64 hex>` auf. Jede Seite löst serverseitig einen `GET /api/review-tokens/<token>` aus. Teilen sich echte Patienten dieselbe Funktionsinstanz-IP, liefert das Portal 429, `resolveToken` gibt `null`, die Seite zeigt 404 für einen gültigen Link. Umgekehrt begrenzt das Limit einen einzelnen Patienten oder Angreifer nicht wirklich. Wegen der 256-Bit-Token ist Raten ohnehin nicht möglich, es geht um Verfügbarkeit.
- Fix-Vorschlag: Limit zusätzlich oder stattdessen je Token (`review-tokens-feedback:<token>`), da das Token die eigentliche Berechtigung ist; optional die Besucher-IP signiert (gemeinsames Geheimnis im Header) von Landing an Portal durchreichen.

### J-9: `eins_app` darf Authentifizierungs- und Betriebstabellen lesen und schreiben, die nie über die App-Rolle laufen
- Schwere: P3
- Art: security
- Sicherheit: niedrig
- Ort: lokaler Katalog (`sessions`, `magic_links`, `schema_migrations`, `geocode_cache`, `timeline_default_steps`, `outreach_videos`, `outreach_video_events`: RLS aus, volle DML für `eins_app`), Ursache `docker/postgres/init/01-extensions.sql:19-22`
- Beleg: Alle Zugriffe auf `sessions` und `magic_links` laufen über `db` (`auth/session.ts`, `auth/magic-link.ts`). Die Tabellen speichern nur Hashes, ein Lesen ist ohne Urbild wertlos, aber ein Schreiben (zum Beispiel `sessions.revoked_at`, `schema_migrations`) ist über eine kaputte App-Rolle-Abfrage möglich.
- Szenario: Ein künftiger SQL-Fehler in einer `withClinicContext`-Abfrage kann Sessions anderer Praxen widerrufen oder Migrationsstand verfälschen. Aktuell kein Pfad bekannt.
- Fix-Vorschlag: Nach Prüfung per `grep dbApp|withClinicContext` und Abfrage aus 2.3 in Neon in derselben Migration wie J-3 `REVOKE ALL ON sessions, magic_links, schema_migrations FROM eins_app;` (und für die `outreach_*`-Tabellen, falls sie in Neon dieselben Grants haben). Standard in der Init-Datei auf einzelne Tabellen statt `ALL TABLES`/`DEFAULT PRIVILEGES` umstellen, damit neue Tabellen nicht automatisch freigegeben werden.

---

## Zusammenfassung

Anzahl Befunde: P0: 0, P1: 2, P2: 4, P3: 3. Teil 1 (alle Server Actions und Routen mit Kennung): keine Lücke im Session-Scoping, kein Pfad nimmt eine `clinicId` aus Client-Eingaben, Rollen werden serverseitig geprüft, Datei-Keys entstehen serverseitig und werden beim Finalisieren gegen das eigene Präfix geprüft.

Die drei dringendsten Punkte:
1. J-1: Eingehende Meta-Leads werden über eine nicht eindeutige Seiten-ID zugeordnet (kein UNIQUE-Index, `data[0]`, `LIMIT 1`), bei Agenturzugang landen Patientenanfragen bei der falschen Praxis.
2. J-2: Der Audit-Eintrag "Anfrage angesehen" trägt bei Impersonation weder Admin-Zuordnung noch IP (`anfragen/[id]/page.tsx:141`), die Übergabe aus WS6 ist offen.
3. J-3: `clinic_notices` und `email_suppression` haben kein RLS und volle Rechte für `eins_app`, Migration `0088` und die Neon-Prüfabfrage liegen in 2.3 bereit.

Annahmen und offene Prüfungen: Produktions-Grants in Neon sind von hier nicht verifizierbar (Abfragen in 2.3). Auf Vercel setzt die Plattform `x-real-ip` (Allowlist und Rate-Limits hängen daran). Dateien der anderen Sitzung wurden nur gelesen.
