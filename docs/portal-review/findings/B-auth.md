# Bereich B: Auth, Sessions, Rollen, Autorisierung

Read-only Review von `apps/portal`. Zeilenangaben mit `~` sind auf wenige Zeilen genau. Dateien unter `wiederbehandlungen/*`, `retreatment*`, Migration 0078, `api/pvs/events/*`, `pvs-status-derive.ts` sind `(in Arbeit, andere Sitzung)` und nur in der Tabelle gelistet.

Was gut ist (kein Finding): Sessions sind JWT (HS256, HKDF-Schlüssel) mit serverseitigem `sha256(tok)`-Eintrag, `getSession` prüft revoked, expiry und `archivedAt` je Request. Cookies tragen in Produktion `__Host-`, Praxis- und Admin-Host sind getrennt. Magic-Link-Tokens liegen nur gehasht in der DB. Argon2id, Passwort-Policy, Postgres-Rate-Limit (fail closed in Produktion). Login-, Reset- und Einladungsmails laufen inline (`sendMagicLinkEmail` direkt), funktionieren also bei abgeschaltetem Worker. Alle `api/pvs/*`-Routen verlangen Clinic-HMAC oder Enrollment-Token und sind ohne Credentials nicht erreichbar.

## Teil 1: Auth-Flows unter echten Bedingungen

### B-1: Magic-Link wird beim GET verbraucht, Mail-Scanner verbrennen ihn
- Schwere: P1
- Art: bug
- Sicherheit: niedrig
- Ort: `src/app/api/auth/callback/route.ts:47`, `src/auth/magic-link.ts:214` (`consumeMagicLink`), `src/auth/magic-link.ts:306` (`consumeMagicLinkForPasswordSetup`), `src/app/admin/login/callback/route.ts`
- Beleg: Der Callback ist ein GET-Handler, der den Token sofort einlöst und markiert (single use). Es gibt keine Zwischenseite. Dagegen nutzt `api/review-tokens/.../unsubscribe` bzw. `retreatment-tokens/.../unsubscribe` schon das Muster GET-Zwischenseite plus POST.
- Szenario: Die Inhaberin bekommt den Anmelde- oder Einladungslink. Outlook Safe Links, Defender oder ein Gateway-Scanner ruft die URL vorab ab. Der Link ist verbraucht, beim echten Klick steht "Der Link wurde bereits verwendet". Bei der ersten Einladung ist das der erste Eindruck von EINS und der Auslöser für "Passwort vergessen" und Supportkontakt. Gleiches gilt für Admin-Login.
- Fix-Vorschlag: GET rendert eine Seite mit einem Button "Jetzt anmelden", der per POST (Server Action) einlöst. Token bleibt bis zum POST unverbraucht. Das Unsubscribe-Muster als Vorlage nehmen.

### B-2: E-Mail-Versand fällt in Produktion still auf die Konsole zurück
- Schwere: P1
- Art: robustness
- Sicherheit: mittel
- Ort: `src/server/email.ts:237-272` (Fallback ab ~250)
- Beleg: `EMAIL_DRIVER` ist standardmäßig `console`. Fehlt `RESEND_API_KEY`, wird auch bei `resend` still der Console-Sender gewählt, ohne Fehler.
- Szenario: Eine fehlende oder rotierte Vercel-Variable (Memory: Resend-Key war geleakt und muss rotiert werden) führt dazu, dass Login-, Reset- und Einladungslinks nur noch in die Logs gehen. Niemand bekommt Mail, die Nutzer sehen "gesendet". Zusätzlich stehen die Tokens im Klartext in den Vercel-Logs.
- Fix-Vorschlag: In `NODE_ENV=production` beim Start oder beim ersten Sendeversuch hart fehlschlagen und alarmieren. Console-Driver nur in dev erlauben.

### B-3: Fehlgeschlagener Mailversand wird verschluckt, Einladung meldet Erfolg, kein erneutes Senden
- Schwere: P1
- Art: ux-flow
- Sicherheit: niedrig
- Ort: `src/auth/magic-link.ts` (`issueMagicLink`), `src/app/(portal)/einstellungen/actions.ts:24-117` (`inviteTeamMemberAction`), `src/lib/constants.ts:278-289`
- Beleg: `issueMagicLink` fängt Resend-Fehler und Suppression ab und gibt neutral zurück. Die Einladung zeigt trotzdem "Einladung verschickt". Für ausstehende Einladungen gibt es keine Aktion "erneut senden". Die TTL ist 15 Minuten, auch für Einladungen. Der Praxisname wird in der Einladungsmail nicht übergeben.
- Szenario: Die Inhaberin lädt die MFA ein, Resend hat einen Aussetzer oder die Adresse ist suppressed. Es kommt keine Mail, die Inhaberin glaubt an Erfolg. Kommt die Mail, ist sie nach 15 Minuten tot, weil die MFA erst am Nachmittag liest. Das Erst-Onboarding einer Praxis hängt außerdem an Seed-Skript plus "Passwort vergessen".
- Fix-Vorschlag: Sendefehler von `issueMagicLink` als Ergebnis zurückgeben und in der Einladungs-UI ehrlich anzeigen. Eigene, längere TTL (z. B. 7 Tage) für Einladungen. Button "Einladung erneut senden". Praxisname in die Mail.

### B-4: Passwort-Setzen ohne Bestätigungsprüfung, Tippfehler sperrt aus
- Schwere: P1
- Art: ux-flow
- Sicherheit: niedrig
- Ort: `src/app/(auth)/set-password/SetPasswordForm.tsx:38`, `:72-76`
- Beleg: Die Abweichung der beiden Felder wird nur als Hinweis im Client angezeigt und blockiert den Submit nicht. Das zweite Feld hat kein `name`, der Server sieht es nie.
- Szenario: Die Inhaberin tippt am Handy das Passwort mit Tippfehler und merkt es nicht. Sie ist eingeloggt, beim nächsten Login passt nichts mehr, der Reset-Link wird im Postfach gesucht, das 10-Mal-pro-Stunde-Limit (B-9) zählt mit.
- Fix-Vorschlag: Submit deaktivieren bei Abweichung, das zweite Feld mit `name` senden und serverseitig vergleichen. Optional "Passwort anzeigen"-Umschalter.

### B-5: Gemeinsamer Rate-Limit-Bucket `login:email` ermöglicht Aussperren
- Schwere: P2
- Art: robustness
- Sicherheit: mittel
- Ort: `src/auth/password.ts`, `src/auth/magic-link.ts` (`issueMagicLink`), `src/server/rate-limit.ts`
- Beleg: Passwortversuche, Magic-Link-Anforderungen und Reset-Anforderungen teilen sich den Bucket `login:email` (10 pro Stunde). Erfolge zählen mit. Das Per-IP-Limit (30 pro Stunde) wird von allen Personen einer Praxis hinter derselben NAT geteilt.
- Szenario: Ein Angreifer schickt 10 Anfragen mit der bekannten Inhaber-Mailadresse. Danach ist Passwort-Login, Magic-Link und Reset für eine Stunde gesperrt. Auch ohne Angreifer sperrt sich die Inhaberin mit Tippfehlern selbst von allen Wiederherstellungswegen aus.
- Fix-Vorschlag: Getrennte Buckets je Pfad, nur fehlgeschlagene Passwortversuche zählen, Link-Anforderung milder (z. B. 1 pro Minute je Adresse) statt hartem Stundenfenster. Reset darf nie vom Passwort-Bucket abhängen.

### B-6: Session ist absolut 8 Stunden, danach Redirect ohne Rücksprung und ohne Hinweis
- Schwere: P2
- Art: ux-flow
- Sicherheit: niedrig
- Ort: `src/auth/session.ts:96-145` (createSession), `src/auth/session.ts:154-229`, `src/auth/guards.ts`
- Beleg: Der Kommentar nennt `SESSION_MAX_AGE` idle, tatsächlich verlängert `lastSeenAt` nichts: absolute 8 Stunden, mit "Angemeldet bleiben" 30 Tage. Abgelaufene Sessions führen per `redirect("/login")` zur Loginseite, ohne `returnTo` (nirgends vorhanden) und ohne Meldung. `session_expired` ist als Fehlercode definiert, wird aber nie verwendet.
- Szenario: Die Inhaberin füllt morgens den Fragebogen halb aus, kommt nach 8 Stunden zurück, klickt "Speichern". Die Server Action leitet auf `/login` um, der Inhalt ist weg, sie landet nach Login auf dem Dashboard.
- Fix-Vorschlag: Sliding Expiry (verlängern bei Aktivität, mit absolutem Deckel) oder Kommentar korrigieren. `returnTo` an `/login` anhängen, `session_expired` anzeigen. Lange Formulare (Fragebogen) lokal zwischenspeichern.

### B-7: E-Mail-Adresse ist nur je Praxis eindeutig, Login ist mehrdeutig
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/db/schema.ts` (`clinicUsers`, Unique auf clinicId+email), `src/auth/password.ts`, `src/auth/magic-link.ts` (`issueMagicLink`), `src/auth/google-login.ts`
- Beleg: Passwort-Login, Magic-Link und Google-Login suchen `.where(email).limit(1)` über alle Praxen, ohne Sortierung.
- Szenario: Dieselbe Person (z. B. Behandler in zwei Praxen) landet je nach Heap-Reihenfolge mal in der einen, mal in der anderen Praxis. Schlimmer: Ein Inhaber einer fremden Praxis kann die Adresse eines Opfers einladen. Ein Google-Login des Opfers kann dann in der fremden Praxis landen, und das Opfer sieht fremde Daten bzw. arbeitet im falschen Mandanten.
- Fix-Vorschlag: Entweder globale Eindeutigkeit der Adresse (ein Konto, mehrere Mitgliedschaften) oder Praxis-Auswahl nach Login, wenn mehrere Treffer existieren. Mindestens deterministisch sortieren und Einladungen für bereits registrierte Adressen anderer Praxen ablehnen.

### B-8: Passwortwechsel per Session ohne aktuelles Passwort, ohne Revoke anderer Sessions
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/app/(auth)/set-password/actions.ts` (`setPasswordWithSessionAction`), `src/app/(portal)/einstellungen/sicherheit/actions.ts`
- Beleg: `setPasswordWithSessionAction` verlangt kein aktuelles Passwort, ist nicht auf Einladungs-/Reset-Sessions beschränkt und widerruft andere Sessions nicht.
- Szenario: Eine gekaperte oder von Admin impersonierte Session setzt das Passwort neu und übernimmt das Konto dauerhaft. Das Opfer ändert sein Passwort nach einem Verdacht, die alte (gestohlene) Session bleibt trotzdem gültig.
- Fix-Vorschlag: Nur in Sessions mit Flag "passwordSetupPending" erlauben. Bei jedem Passwortwechsel und Reset alle anderen Sessions des Nutzers widerrufen. Impersonation darf nie Passwörter setzen (siehe B-17).

### B-9: Reset-Seite und Fehlermeldungen irreführend
- Schwere: P3
- Art: copy
- Sicherheit: niedrig
- Ort: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/forgot-password/page.tsx`
- Beleg: `?error=invalid` zeigt immer "E-Mail oder Passwort stimmt nicht", auch bei verbrauchtem oder abgelaufenem Link. Fehlercodes `impersonation_*` sind nicht abgebildet. Reset-Seite: "Vergessene Passwörter sind kein Drama. Hier weiterbewegen." ist unklar.
- Szenario: Nach einem Scanner-Treffer (B-1) liest die Inhaberin "Passwort stimmt nicht" und versucht ihr Passwort mehrfach, was den Bucket aus B-5 füllt.
- Fix-Vorschlag: Eigene Texte je Fehlercode: "Der Link ist abgelaufen oder wurde schon verwendet. Fordern Sie einen neuen an." plus Button. Reset-Text klar und kurz: "Passwort zurücksetzen".

### B-10: Gesperrte oder zurückgewiesene Adressen erhalten still keine Mail
- Schwere: P2
- Art: ux-flow
- Sicherheit: niedrig
- Ort: `src/server/email-suppression.ts`, `src/auth/magic-link.ts` (`issueMagicLink`)
- Beleg: Adressen mit Bounce oder Complaint werden von Login-Mails still ausgenommen, die UI sagt "Link gesendet".
- Szenario: Eine Praxis-Adresse war einmal als Spam markiert. Die Inhaberin wartet auf einen Link, der nie kommt, und kann sich nur mit Passwort anmelden, das sie nie gesetzt hat.
- Fix-Vorschlag: Transaktionale Auth-Mails von der Marketing-Suppression ausnehmen (Hard Bounce ausgenommen), oder intern alarmieren und der Inhaberin einen alternativen Weg nennen.

### B-11: Entfernte Teammitglieder behalten gültige Sessions, Reaktivierung belebt sie wieder
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/app/(portal)/einstellungen/actions.ts:120-187` (`removeTeamMemberAction`), `:24-117` (Einladung)
- Beleg: Entfernen setzt nur `archivedAt` und widerruft keine Sessions. `getSession` prüft `archivedAt` je Request, solange die Zeile archiviert ist, ist der Zugriff blockiert. Wird die Person später neu eingeladen (Reaktivierung), sind alte, unwiderrufene und nicht abgelaufene Sessions (bis 30 Tage mit "Angemeldet bleiben") wieder gültig.
- Szenario: Eine ausgeschiedene MFA wird entfernt, ein Monat später wieder eingeladen. Ihr altes Notebook, das noch eingeloggt war, ist plötzlich wieder drin.
- Fix-Vorschlag: Beim Entfernen und beim Reaktivieren alle Sessions des Nutzers widerrufen.

### B-12: Archivierte Praxis: Nutzer können weiterarbeiten
- Schwere: P2
- Art: bug
- Sicherheit: mittel
- Ort: `src/auth/session.ts:154-229` (getSessionImpl), `src/app/admin/clinics/[id]/actions.ts` (`archiveClinicAction`)
- Beleg: `getSession` prüft `clinic_users.archivedAt`, aber nicht `clinics.archivedAt`.
- Szenario: Admin archiviert eine gekündigte Praxis (Garantie nicht ausgelöst, Vertrag beendet). Die Nutzer sind weiter eingeloggt, können sich neu anmelden, Klon-Daten und Anfragen weiter sehen und bearbeiten. Das widerspricht dem Löschkonzept (Modell spätestens 30 Tage nach Vertragsende gelöscht).
- Fix-Vorschlag: In `getSession` per Join auf `clinics.archivedAt` prüfen, Login ebenso. `archiveClinicAction` zusätzlich alle Sessions der Praxis widerrufen.

### B-13: Admin-IP-Allowlist nur exakter String-Vergleich, wirft bei jedem Request aus
- Schwere: P2
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/auth/admin.ts`, `src/auth/admin-guards.ts`
- Beleg: Allowlist ist ein `includes`-Vergleich. Kein CIDR, kein IPv4/IPv6-Normalisieren. Geprüft wird bei jedem Lesen der Admin-Session. In Produktion fail closed, außer `ADMIN_IP_ALLOWLIST_DISABLED`.
- Szenario: Karam wechselt mit dem Handy ins Mobilnetz oder die Heim-IP wechselt (v6/v4-Flip). Er wird mitten in der Sitzung ausgeloggt oder kommt gar nicht mehr in den Admin, während Outreach-Auswertungen anstehen. Notfallzugang nur über Env-Änderung und Deploy.
- Fix-Vorschlag: CIDR-Unterstützung und IPv4-mapped-Normalisierung. Zweiter Faktor (Magic-Link plus Passwort) bleibt ohnehin bestehen, die IP-Sperre nur als Zusatz mit Break-Glass-Pfad.

### B-14: Session-Rotation beim Login fehlt
- Schwere: P3
- Art: security
- Sicherheit: niedrig
- Ort: `src/auth/session.ts:96-145`
- Beleg: Beim Login wird eine neue Session angelegt, eine vorhandene alte Session-Zeile des Geräts bleibt gültig.
- Szenario: Geteilter Rechner in der Praxis: Alte Sessions bleiben bestehen, bis sie ablaufen.
- Fix-Vorschlag: Beim Login die Session des mitgesendeten Cookies widerrufen.

### B-15: GET-Logout und GET-End-Impersonation sind per CSRF auslösbar
- Schwere: P3
- Art: security
- Sicherheit: niedrig
- Ort: `src/app/api/auth/logout/route.ts`, `src/app/api/auth/end-impersonation/route.ts`
- Beleg: Beide reagieren auf GET, Cookie `sameSite=lax` wird bei Top-Level-Navigation mitgesendet.
- Szenario: Ein `<img src=".../api/auth/logout">` auf einer fremden Seite loggt Nutzer aus.
- Fix-Vorschlag: Auf POST umstellen.

### B-16: Weitere kleine Auth-Punkte
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/auth/google-login.ts` (State), `src/auth/magic-link.ts` (`issueMagicLink`, früher Return bei unbekanntem Nutzer), `src/app/(portal)/einstellungen/sicherheit/actions.ts` (`changePasswordAction`), `src/app/admin/login/*`, `src/app/(portal)/einstellungen/avatar-actions.ts`, `src/app/admin/set-password/actions.ts`
- Beleg:
  - Google-State-Nonce ist nicht an das id_token gebunden und nicht einmalig.
  - `issueMagicLink` kehrt bei unbekannter Adresse früh zurück, das Antwortzeit-Delta ist ein Enumerations-Orakel.
  - `changePasswordAction` hat kein Rate-Limit auf die Prüfung des aktuellen Passworts.
  - Admin-Magic-Link- und Reset-Versand sind nicht in try/catch gewickelt (nur Admin betroffen).
  - Avatar-Upload vertraut dem Client-`file.type`.
  - Admin-Set-Password-Copy sagt "mindestens 10 Zeichen", die Policy verlangt 12 (`ERR_POLICY`).
  - Der Einladungs-Modus (`?mode=invite`) legt eine Session an, bevor ein Passwort existiert.
- Szenario: Jeweils niedrig. Sammelpunkt für Aufräumarbeit.
- Fix-Vorschlag: Nonce an Cookie und einmalig verbrauchen. Früh-Return durch gleiche Arbeit angleichen. Rate-Limit auf `changePasswordAction`. try/catch im Admin. Magic-Bytes beim Avatar prüfen. Copy auf 12 Zeichen korrigieren.

## Teil 2: Autorisierungs-Sweep

Legende: authn = Session bzw. Token erforderlich. role = `can()`-Prüfung. tenant = Mandantenbindung (RLS via `withClinicContext` oder Superuser `db` mit clinicId aus der Session). validation = Eingabeprüfung der Client-Ids und Felder. ok = in Ordnung, n/a = nicht anwendbar.

| file | export | authn | role | tenant | validation | verdict |
|---|---|---|---|---|---|---|
| `(portal)/_components/tour/actions.ts` | tour progress actions | ja | n/a (eigene Zeile) | Session-User | ok | OK |
| `(portal)/anfragen/[id]/actions.ts` | logCall, changeStatus, notes | ja | `requests.update` | `withClinicContext` (RLS) | uuid | OK (Fehlertext siehe B-26) |
| `(portal)/bewertungen/feedback/actions.ts` | status, note | ja | ja | clinicId aus Session | ok | OK |
| `(portal)/dashboard/_components/anomaly-actions.ts` | dismiss, snooze | ja | n/a (eigene Zeile) | Session | ok | OK |
| `(portal)/dateien/actions.ts` | delete, send | ja | `uploads.send` | Key-Präfix `clinicId/uploads/` | ok | OK |
| `(portal)/einstellungen/actions.ts` | updateClinicSettings | ja | inhaber | Session | zod | OK |
| `(portal)/einstellungen/actions.ts` | inviteTeamMember | ja | `settings.team`, Rollen-Deckel | Session | zod | OK, aber B-3, B-7 |
| `(portal)/einstellungen/actions.ts` | removeTeamMember | ja | `settings.team`, letzter-Inhaber-Schutz | Session | zod | OK, aber B-11 |
| `(portal)/einstellungen/actions.ts` | rotate secrets, disconnect | ja | `settings.integrations` | Session | ok | OK |
| `(portal)/einstellungen/avatar-actions.ts` | upload, remove avatar | ja | n/a (eigene Zeile) | Session | file.type vertraut | OK (B-16) |
| `(portal)/einstellungen/integrationen/actions.ts` | mapTreatmentAction, mapLocationAction | ja | `settings.integrations` | Superuser `db` mit clinicId, aber Ziel-Id nicht geprüft | keine Laufzeitprüfung | FAIL (B-19) |
| `(portal)/einstellungen/integrationen/actions.ts` | resolveLinkingFailureAction, ignoreLinkingFailureAction, issueAgentEnrollmentAction, setStatus | ja | ja | clinic-scoped | nicht validiert | FAIL (B-19) |
| `(portal)/einstellungen/integrationen/actions.ts` | syncReviewsNowAction | ja | ja | Session | n/a | FAIL (B-20, kein Rate-Limit) |
| `(portal)/einstellungen/sicherheit/actions.ts` | changePassword, logoutAllDevices, setPasswordWithSession | ja | n/a (eigene Zeile) | Session | Policy | OK mit B-8, B-16 |
| `(portal)/feedback/actions.ts` | submit feedback | ja | ja | Session | zod | OK |
| `(portal)/hwg-check/actions.ts` | check | ja | ja | Session | zod | OK |
| `(portal)/leitfaden/pruefung/actions.ts` | submit | ja | ja | Session | ok | OK |
| `(portal)/medien/actions.ts` | approve, comment | ja | ja | Session, `withClinicContext` | uuid | OK |
| `(portal)/onboarding/checkliste/actions.ts` | complete items | ja | `onboarding.complete` | Session | ok | OK |
| `(portal)/onboarding/fragebogen/actions.ts` | save, submit | ja | `onboarding.complete` | Session | zod | OK |
| `(portal)/wiederbehandlungen/actions.ts` | alle | ja | ja | Session | (in Arbeit, andere Sitzung) | nicht bewertet |
| `admin/animations/actions.ts` | alle | `requireAdmin` | admin | explizit clinicId aus Eingabe, Admin darf alle | zod | OK |
| `admin/clinics/[id]/actions.ts` | archive, update | `requireAdmin` | admin | wie oben | zod | OK (B-12) |
| `admin/clinics/[id]/dsgvo/actions.ts` | export, delete | `requireAdmin` | admin | wie oben | zod | OK |
| `admin/garantie/actions.ts` | alle | `requireAdmin` | admin | wie oben | zod | OK |
| `admin/journey/actions.ts` | alle | `requireAdmin` | admin | wie oben | zod | OK |
| `admin/pvs-bridge/konfigurationen/actions.ts` | alle | `requireAdmin` | admin | wie oben | zod | OK |
| `admin/rueckruf/actions.ts` | alle | `requireAdmin` | admin | wie oben | zod | OK |
| `admin/videos/actions.ts` | alle | `requireAdmin` | admin | wie oben | zod | OK |
| `server/actions/pvs-csv-upload.ts` | uploadCsv, confirmCsvMapping, getCsvUploadStatus, listRecentCsvUploads | ja | keine | clinicId aus Session | uploadId/groupId nicht als uuid geprüft | FAIL (B-18, B-21) |
| `api/admin/clinics/*/dsgvo/export` | GET | `requireAdminForApi` | admin | per Pfad-Id | uuid | OK |
| `api/admin/files` | GET | Admin-Session | admin | admin | ok | OK |
| `api/admin/pvs/events` (+replay) | GET, POST | Admin | admin | admin | ok | (in Arbeit, andere Sitzung) |
| `api/auth/callback` | GET | Token | n/a | Token | Token-Hash | OK, aber B-1 |
| `api/auth/logout` | GET | Cookie | n/a | Session | n/a | OK (B-15) |
| `api/auth/start-impersonation` | POST | Admin-Einmaltoken (60 s) | admin | Zielnutzer im Token | Token | OK (Teil 3) |
| `api/auth/end-impersonation` | GET | Session | n/a | Session | n/a | OK (B-15) |
| `api/auth/google/start`, `google/callback` | GET | State | n/a | State-Cookie | ok | OK (B-16) |
| `api/dev/email-preview` | GET | nur dev | n/a | n/a | n/a | OK (prod nicht erreichbar, sollte bestätigt werden) |
| `api/files` | GET | Session | n/a | clinic-Präfix | ok | OK, dev-only Local-Driver (B-25) |
| `api/health` | GET | offen | n/a | n/a | n/a | OK (keine Daten) |
| `api/integrations/google/{start,callback}` | GET | Session | `settings.integrations` | State an Praxis und Nutzer gebunden | ok | OK |
| `api/integrations/meta/{start,callback}` | GET | Session | `settings.integrations` | State an Praxis und Nutzer gebunden | ok | OK |
| `api/kpis` | GET | `withApi` | Rolle via Session | Session | Query | OK |
| `api/leads/intake` | POST | HMAC pro Praxis | n/a | clinicId im Body, Signatur | zod | FAIL (B-17) |
| `api/notifications` (+read) | GET, POST | `withApi` | ja | Session | ok | OK |
| `api/public/videos/*` | GET | öffentlich per Token | n/a | Token | ok | OK |
| `api/requests` | GET | `withApi` | ja | Session | Query | OK |
| `api/retreatment-tokens/*` | GET, POST | Token plus Rate-Limit | n/a | Token | ok | (in Arbeit, andere Sitzung) |
| `api/review-tokens/*` | GET, POST | Token plus Rate-Limit | n/a | Token | ok | OK, aber GET löst Abmeldung aus (B-22) |
| `api/search/leads` | GET | `withApi` | ja | Session | Query | OK |
| `api/uploads` | POST | Session | `uploads.send` | clinic-Präfix | ok | OK, dev-only Local-Driver (B-25) |
| `api/videos` (+upload-target) | POST | Bearer-Token | Token | Token | ok | OK |
| `api/vitals` | POST | offen | n/a | n/a | n/a | OK, Rate-Limit schwach (B-24) |
| `api/webhooks/resend` | POST | HMAC | n/a | n/a | ok | OK |
| `api/webhooks/meta/leadgen` | GET, POST | HMAC | n/a | Page-zu-Praxis-Mapping | ok | OK |
| `api/pvs/*` | alle | Clinic-HMAC oder Enrollment-Token | n/a | HMAC | ok | Nur Bestätigung: ohne Credentials nicht erreichbar. `events/*`: (in Arbeit, andere Sitzung) |

Fehlgeschlagene Zeilen als Findings:

### B-17: Lead-Intake: Rate-Limit vor Signaturprüfung, ungesicherte Anfragen können echte Anfragen blockieren
- Schwere: P1
- Art: security
- Sicherheit: hoch
- Ort: `src/app/api/leads/intake/route.ts:~175-203` (Rate-Limit), `:~208` (Signatur)
- Beleg: Der Bucket pro Praxis (60 pro 10 Minuten) wird vor der Signaturprüfung belastet. Die `clinicId` ist öffentlich (steht in Zielseiten-URLs bzw. Tracking). Jeder unsignierte Reject schreibt zusätzlich eine Audit-Zeile. Das IP-Gate nimmt das linke Element von `x-forwarded-for` (fälschbar) statt `trustedIpFromHeaders`.
- Szenario: Ein einziger Client schickt 60 unsignierte POSTs. Danach laufen alle echten Anfragen der Praxis für 10 Minuten in 429. Das trifft direkt die Garantie "erste qualifizierte Anfrage über EINS" (Zeitfenster 90 Tage, jede verlorene Anfrage ist eine verlorene Rechnung) und bläht die Audit-Tabelle auf. Ein gezielter Wettbewerber könnte das dauerhaft tun.
- Fix-Vorschlag: Erst Signatur prüfen, dann Praxis-Limit. Unsignierte Requests nur per Einzel-IP-Limit mit `trustedIpFromHeaders` drosseln und nicht in Audit schreiben. Praxis-Limit nur für signierte Aufrufe.

### B-18: CSV-Import ohne Rollenprüfung
- Schwere: P1
- Art: security
- Sicherheit: hoch
- Ort: `src/server/actions/pvs-csv-upload.ts:47` (`uploadCsv`), `:136` (`confirmCsvMapping`), `:205` (`getCsvUploadStatus`), `:235` (`listRecentCsvUploads`); `src/app/(portal)/einstellungen/integrationen/setup/csv/page.tsx`
- Beleg: Nur `requireSession`, kein `can("settings.integrations")`. Auch die Seite prüft nur die Session.
- Szenario: Eine Empfangskraft (frontdesk) kann Patienten- und Rechnungs-CSVs einspielen und damit Umsatz- und Behandlungsdaten der Praxis, also die Grundlage der Abrechnung nach "Behandelten Patienten", verändern oder verfälschen. Rolle ist laut `roles.ts` für Integrationen nur der Inhaber.
- Fix-Vorschlag: In allen vier Exporten und auf der Seite `can(role, "settings.integrations")` erzwingen.

### B-19: Zuordnungs- und Fehlerauflösungs-Actions ohne Laufzeitvalidierung, Cross-Tenant-Referenzen möglich
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/app/(portal)/einstellungen/integrationen/actions.ts:203-273` (`mapTreatmentAction`, `mapLocationAction`, `resolveLinkingFailureAction`, `ignoreLinkingFailureAction`, `issueAgentEnrollmentAction`, `setStatus`)
- Beleg: `portalTreatmentId`, `portalLocationId`, `mappingId` und `setStatus` werden nicht per zod geprüft, nicht als uuid, und es fehlt eine Prüfung, dass das Ziel zur Session-Praxis gehört. Eine Nicht-UUID erzeugt einen Postgres-500. `resolveLinkingFailureAction` meldet auch bei No-op ok. (Gegenprobe: `manuallyResolveLinkingFailure` in `server/pvs-linking.ts` ist sauber clinic-scoped und prüft den Patienten.)
- Szenario: Ein Inhaber (oder ein Angreifer mit einer Inhaber-Session) trägt die Behandlungs-Id einer anderen Praxis als Ziel ein. Die Zeile der eigenen Praxis verweist dann auf fremde Stammdaten, Auswertungen und Namen können durchsickern.
- Fix-Vorschlag: zod-Schema mit `z.string().uuid()` und Enum für Status. Ziel-Zeile in derselben Praxis nachschlagen, sonst ablehnen. Rückgabe der Anzahl geänderter Zeilen prüfen.

### B-20: `syncReviewsNowAction` ohne Rate-Limit
- Schwere: P2
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/app/(portal)/einstellungen/integrationen/actions.ts`
- Beleg: Jeder Klick löst einen externen API-Sync (Google Reviews) aus, kein Limit.
- Szenario: Doppelklick, Schleifenskript oder wütender Nutzer verbrennt Google-Kontingent und Kosten.
- Fix-Vorschlag: `rateLimit` je Praxis (z. B. 1 pro 5 Minuten), Button während Lauf deaktivieren.

### B-21: CSV-Upload: Größenobergrenzen widersprechen sich, Import hängt bei ausgeschaltetem Worker ewig auf "processing"
- Schwere: P2
- Art: bug
- Sicherheit: niedrig
- Ort: `src/server/actions/pvs-csv-upload.ts:47`, `next.config.*` (`bodySizeLimit` 10mb), Vercel-Limit, `enqueuePvsCsvIngest`
- Beleg: Der Code erlaubt 50 MB, Next begrenzt Server-Action-Bodys auf 10 MB, Vercel Functions erlauben etwa 4,5 MB Request-Body. `uploadId` und `uploadGroupId` sind nicht als uuid geprüft. Die Verarbeitung läuft über `enqueuePvsCsvIngest`, also über den Worker (Fly).
- Szenario: Praxis lädt eine echte Patienten-CSV mit 12 MB hoch, bekommt eine kryptische Fehlermeldung. Kleine Dateien gehen durch, bleiben aber bei abgeschaltetem oder verzögertem Worker unbegrenzt auf "processing".
- Fix-Vorschlag: Direkt-Upload zu R2 per Presigned URL, Limits konsistent im UI nennen, uuid prüfen, Statusanzeige "wartet auf Verarbeitung" mit Zeitstempel und Fehler nach Timeout.

### B-22: Abmelden von Bewertungsmails passiert schon beim GET (Scanner melden Patienten ab)
- Schwere: P2
- Art: bug
- Sicherheit: niedrig
- Ort: `apps/clinic-landing/app/r/unsubscribe/page.tsx` (außerhalb Bereich B, Querverweis), `src/app/api/review-tokens/[token]/unsubscribe/route.ts`
- Beleg: Die Seite meldet beim Rendern (GET) ab, der Kommentar verweist auf § 7 UWG. Die Portal-Route reagiert bei GET sofort. `retreatment-tokens/.../unsubscribe` hat dagegen bereits Zwischenseite plus POST.
- Szenario: Ein Mail-Scanner ruft den Link in der Bewertungsmail ab, der Patient ist still abgemeldet und bekommt nie eine Erinnerung. Das senkt die Bewertungsquote unsichtbar.
- Fix-Vorschlag: Wie beim Wiederbehandlungs-Muster: GET zeigt Bestätigung, POST meldet ab. Alternativ List-Unsubscribe-Post-Header für One-Click.

### B-23: Server-Action-Fehlertexte werden in Produktion maskiert
- Schwere: P2
- Art: ux-flow
- Sicherheit: niedrig
- Ort: `src/app/(portal)/anfragen/[id]/_lead-cockpit.tsx` (`run()` zeigt `e.message`), `CallOutcomeActions`, viele `throw new Error` bzw. `ForbiddenError` in Actions
- Beleg: Next maskiert in Produktions-Builds die Nachrichten geworfener Fehler in Server Actions zu einem generischen Text. Das Cockpit zeigt `e.message` an. Das ist aus dem Code abgeleitet und nicht im Produktionsbuild verifiziert (Konfidenz mittel).
- Szenario: Statt "Statuswechsel nicht erlaubt" oder "Status wird von Ihrer PVS gesteuert" sieht die Mitarbeiterin einen generischen Fehler und versteht nicht, warum Klick nichts bewirkt.
- Fix-Vorschlag: Actions geben ein Ergebnisobjekt `{ ok: false, message }` zurück statt zu werfen, die UI zeigt `message`. Mit `next build && next start` prüfen.

## Teil 3: Impersonation

Ablauf: `/admin/start-impersonation` erzeugt einen 60-Sekunden-Einmaltoken, POST `/api/auth/start-impersonation` löst ihn ein und legt eine Session mit `impersonatedByAdminId` an. Der Einmaltoken ist sauber. Die Probleme liegen in der Lebensdauer, im Audit und im Umfang der erlaubten Aktionen.

### B-24: Impersonations-Audit ist unbrauchbar: Aktionen laufen unter der echten Nutzer-Id
- Schwere: P1
- Art: security
- Sicherheit: hoch
- Ort: `src/server/audit.ts` (`writeAudit`, kein Impersonation-Feld), `src/auth/impersonation.ts`
- Beleg: Nur `impersonate_start` und `impersonate_end` werden protokolliert, mit `actorId` null. Alle Aktionen innerhalb der Session (logCall, changeStatus, Fragebogen, Checkliste, Team einladen und entfernen, Secrets rotieren, Verbindungen trennen) schreiben `actorId` = Inhaber-Id.
- Szenario: Der Admin ruft über "Ansicht als Nutzer" `logCall` auf. Das setzt `firstContactedAt` und zählt als Kontaktversuch für die 48-Werkstunden-Regel, die Garantie und Vertragsstrafen. In der Audit-Spur sieht es aus, als hätte die Inhaberin angerufen. Im Streitfall ist nicht belegbar, wer handelte.
- Fix-Vorschlag: `writeAudit` liest automatisch `session.impersonatedByAdminId` und speichert `actorId` plus `onBehalfOfAdminId`. Zusätzlich Spalte `impersonated: true`, im Admin-Log sichtbar. Aktionen wie `logCall` sollten in Impersonation gar nicht als echte Kundenaktion zählen.

### B-25: Impersonations-Session gilt 8 Stunden, ist nicht an die Admin-Session gebunden
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/auth/impersonation.ts`, `src/auth/session.ts:96-145`
- Beleg: Die Impersonations-Session übernimmt die reguläre `SESSION_MAX_AGE` (8 Stunden), der Kommentar nennt sie kurzlebig. Admin-Logout oder Entfernen aus der Allowlist beendet sie nicht. `issueIp` wird gespeichert, aber nie verglichen.
- Szenario: Der Admin schließt die Sitzung oder verliert seinen Zugriff, die Impersonations-Session bleibt bis zu 8 Stunden voll nutzbar. Ein abgegriffenes Cookie wirkt als Praxis-Inhaber.
- Fix-Vorschlag: Harte Obergrenze 30 Minuten, bei jedem Request prüfen, dass die Admin-Session `impersonatedByAdminId` noch gültig ist, sonst widerrufen. `issueIp` vergleichen. Sichtbares Banner mit Restzeit.

### B-26: Impersonation ohne Lesemodus, Admin kann destruktive Aktionen als Inhaber ausführen
- Schwere: P2
- Art: security
- Sicherheit: hoch
- Ort: `src/auth/guards.ts`, `src/app/(portal)/einstellungen/actions.ts` (Team, Secrets), `src/app/(portal)/einstellungen/sicherheit/actions.ts` (`logoutAllDevices`, Passwort), `src/app/(portal)/dateien/actions.ts`
- Beleg: Es gibt keinen Read-only-Modus. Möglich sind unter anderem: Teammitglieder entfernen und einladen, Secrets rotieren, OAuth-Verbindungen trennen, Uploads löschen, Passwort setzen (siehe B-8), Sitzungen aller Geräte beenden.
- Szenario: Ein Klick im Support-Fall ("Ansicht als Nutzer") entfernt versehentlich den letzten Behandler oder trennt die Meta-Verbindung der Praxis, die Auswertung bricht ab und die Praxis sieht es erst Tage später.
- Fix-Vorschlag: In `getSession` ein Flag `readOnly` für Impersonation, in den Mutationen oder zentral in `can()` alle schreibenden Rechte für impersonierte Sessions verneinen, mit einer kleinen Allowlist (z. B. Notizen, wenn ausdrücklich gewollt).

### B-27: Impersonations-Beendigung und Rücksprung unklar
- Schwere: P3
- Art: ux-flow
- Sicherheit: niedrig
- Ort: `src/app/api/auth/end-impersonation/route.ts`, `src/app/admin/layout.tsx`
- Beleg: Das Ende ist ein GET (B-15). Der Admin-Layout selbst gatet nicht, jede Admin-Seite ruft `requireAdmin` einzeln auf. Bisher haben alle `page.tsx` den Aufruf, außer den Auth-Seiten (`forgot-password`, `set-password`), das ist korrekt, aber nur per Konvention gesichert.
- Szenario: Eine neue Admin-Seite vergisst `requireAdmin` und ist offen.
- Fix-Vorschlag: Gate zentral im Admin-Layout (Route-Gruppe `(authed)`), Auth-Seiten außerhalb. Lint-Regel oder Test, der jede `admin/**/page.tsx` auf `requireAdmin` prüft.

## Weitere Findings aus dem Sweep

### B-28: `/api/vitals` mit fälschbarer IP und Isolate-lokalem Limit
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/app/api/vitals/route.ts`
- Beleg: Das linkeste `x-forwarded-for`-Element wird als IP genutzt, das Limit liegt im Speicher je Serverless-Isolate.
- Szenario: Der Endpunkt ist offen und kann mit gefälschten IPs geflutet werden. Folge sind Logzeilen, keine Daten.
- Fix-Vorschlag: `trustedIpFromHeaders` plus Postgres-Limit oder Vercel-eigene Drosselung.

### B-29: `/api/files` und `/api/uploads` hängen am Local-Storage-Driver
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/app/api/files/route.ts`, `src/app/api/uploads/route.ts`
- Beleg: Kommentare behaupten, die Routen antworteten in Produktion mit 404. `/api/files` hat keine ausdrückliche Prüfung, sondern verlässt sich darauf, dass der Driver lokal nicht verfügbar ist. Mandantenbindung (Präfix `clinicId/`) ist vorhanden.
- Szenario: Ein falsch gesetzter `STORAGE_DRIVER=local` in Produktion würde Dateien auf der flüchtigen Function-Platte ablegen.
- Fix-Vorschlag: Ausdrückliches 404 bei `NODE_ENV=production` bzw. wenn der Driver nicht lokal ist.

## Design-Kritik (nur Kritik)

- Login-Maske: zwei Modi (Passwort und "Lieber per E-Mail-Link anmelden") plus Google auf einem Handy-Bildschirm. Für Inhaber:innen von 48 bis 58 Jahren ist unklar, was der Hauptweg ist. Die zwei Eingabefelder und der Textlink "Lieber per E-Mail-Link anmelden" konkurrieren, der Link wirkt wie Nebensache und ist doch der Weg, den die meisten ohne Passwort brauchen.
- Fehlermeldungen auf der Loginseite sind generisch und teilweise falsch (B-9). Nach einem abgelaufenen Link gibt es keinen Button "Neuen Link anfordern".
- Einladungs-Flow: Nach dem Klick landet die Person ohne Erklärung im Passwort-Setzen-Formular (B-4, B-16), der Praxisname fehlt in der Mail, der Link lebt nur 15 Minuten.
- Admin-Auth-Seiten: `admin/set-password/page.tsx` nutzt ein Label im Versalien-Stil (uppercase mit Letter-Spacing), das gegen die Projektregel "Kein All-Caps, Sentence case" verstößt. Nicht gesondert verifiziert, bitte beim Fix prüfen.
- Impersonations-Banner (falls vorhanden) zeigt weder Restzeit noch Lesemodus (B-25, B-26). Der Admin kann nicht erkennen, dass er gerade als Inhaber handelt.
- Reset-Seite: Ton ("Kein Drama") passt nicht zur formellen Sie-Ansprache und zur Zielgruppe.

## Zusammenfassung

Insgesamt 29 Findings: P0: 0, P1: 7, P2: 15, P3: 7.

Die drei dringendsten Punkte:
1. B-17: Im Lead-Intake läuft das Praxis-Rate-Limit vor der Signaturprüfung, ein einzelner Client kann alle echten Anfragen einer Praxis sperren und damit die Garantie-Auslösung blockieren.
2. B-1 und B-2: Magic-Links werden schon beim GET verbraucht (Mail-Scanner) und der Mailversand fällt in Produktion still auf die Konsole zurück, Einladungen und Logins der ersten Praxen können so scheitern.
3. B-18 und B-24: Der CSV-Import hat keine Rollenprüfung, und Aktionen in einer Impersonations-Session werden unter der Nutzer-Id protokolliert, was Abrechnungsdaten und Garantie-Nachweis angreifbar macht.
