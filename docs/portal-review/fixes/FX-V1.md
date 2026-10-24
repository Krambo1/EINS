# FX-V1: Sicherheit (Nacharbeit aus V3, V4, V6)

| ID | Status | Dateien | Was und warum |
|---|---|---|---|
| V3 Neben 2 | fixed | `(auth)/login/actions.ts`, `server/rate-limit-slot.ts` (neu), Tests `(auth)/login/actions.test.ts`, `server/rate-limit-slot.test.ts`, `server/rate-limit-slot.db.test.ts` (neu) | Jeder Passwort-Versuch reserviert vor Argon2 atomar je einen Platz im Adress- und IP-Bucket (bedingtes Upsert `count < limit`, gleiche Schlüssel, 10/h bzw. 30/h), richtiges Passwort gibt beide zurück (Erfolge zählen weiter nicht), abgewiesene Versuche zählen nicht, Meldung unverändert; Tests: 25 parallele Versuche auf eine Adresse = genau 10 Argon2-Prüfungen, 50 auf eine IP = 30, echte DB: 40 parallele Reservierungen = genau 10. |
| V3 Neben 1 | fixed | `(portal)/einstellungen/actions.ts`, Test `(portal)/einstellungen/actions.archive.test.ts` (neu) | `archiveTreatmentAction` und `archiveLocationAction` lesen per `.returning()` die geänderten Zeilen; 0 Zeilen (fremde oder veraltete Id) wirft `SettingsUserError` "Diese Behandlung wurde nicht gefunden." bzw. "Dieser Standort wurde nicht gefunden." (Muster wie beim Teammitglied), also Fehlermeldung "Archivieren fehlgeschlagen", kein Erfolg, kein Audit "delete". |
| V3 Neben 5 | fixed | `lib/review-url-allowlist.ts`, `lib/review-url-allowlist.test.ts` | Erster Pfadabschnitt muss genau `maps` (www.google.com/google.com) bzw. `local` (search.google.com, mit Folgeabschnitt) sein, damit fallen `/mapsx` und `/maps%2f..%2furl`; zusätzlich wird jeder weitere Abschnitt bis zu dreimal dekodiert und abgewiesen, wenn darin ein `.`/`..`-Schritt hinter `/` oder `\` steckt (`/maps/x%2f..%2f..%2furl`, doppelt kodiert, kaputte Kodierung); `%2F` in Ortsnamen bleibt erlaubt; 17 neue Ablehn- und 8 Annahmefälle. |
| V3 Neben 6 | fixed | `(auth)/login/page.tsx` | Die vier `impersonation_*`-Fehlertexte sagen jetzt "Kundenansicht" wie der Banner und sprechen mit Sie an ("Bitte starten Sie sie im Admin-Bereich erneut."), kein Gedankenstrich; `impersonation_no_user` war schon neutral. |
| V4 Neben 6 | fixed | `lib/email-delivery-error.ts` (neu), `server/email.ts`, `lib/flash.ts`, Tests `lib/flash.test.ts`, `server/email.delivery-error.test.ts` (neu) | Neue interne Klasse `EmailDeliveryError` (abhängigkeitsfrei, von `server/email.ts` re-exportiert) für "Resend send failed", Resend-Zeitüberschreitung und "Email provider not configured"; `isUserFacingError` weist sie ausdrücklich ab (zusätzlich zur Unterklassen-Regel), die Praxis sieht den deutschen Standardtext, das Log bekommt Name und gesäuberte Meldung; schlichte deutsche `Error`s bleiben unverändert sichtbar (Test). Kein Aufrufer wertet die englischen Texte per String aus. |
| V6 Copy "Conversion-Einstellungen" | fixed | `(portal)/einstellungen/actions.ts` | Erfolgs-Toast von `updateAdsConversionConfigAction` lautet jetzt "Einstellungen für Abschluss-Meldungen gespeichert" (passend zum Knopf, den FX-V3 auf `ads-conversion/page.tsx` setzt); Button und Link auf den Seiten gehören FX-V3. |
| V3 Neben 2 (Admin-Login) | fixed | `admin/login/actions.ts`, Test `admin/login/actions.test.ts` (neu) | Gleicher Umbau wie beim Praxis-Login: Platz im Adress- und IP-Bucket (10/h, 30/h, Admin-Scopes) atomar vor Argon2 reservieren, zurückgeben erst nach erzeugter Admin-Session; Meldungen unverändert. Bewusst enger als vorher: ein richtiges Passwort von einer IP außerhalb der Admin-Allowlist zählt jetzt als Fehlversuch (vorher nicht gezählt, dadurch war ein Treffer an der Restzahl erkennbar). Test: 25 parallele Versuche = 10 Argon2-Prüfungen, 50 auf eine IP = 30. |
| V3 Neben 2 (Passwort ändern) | fixed | `(portal)/einstellungen/sicherheit/actions.ts`, Test `(portal)/einstellungen/sicherheit/actions.test.ts` (neu) | Bucket "falsches aktuelles Passwort" (10/h je Nutzer, B-16) reserviert jetzt atomar vor Argon2, richtiges aktuelles Passwort gibt den Platz zurück, Meldungen unverändert. Test: 25 parallele Absendungen = 10 Argon2-Prüfungen, kein neues Passwort geschrieben. |

## Braucht andere Datei

- `auth/rate-limit-policy.ts` Kopfkommentar ("checked with a peek before the Argon2 verify") ist veraltet: alle drei Passwort-Wege reservieren jetzt vor Argon2 und geben bei Erfolg zurück. `peekRateLimit` in `server/rate-limit.ts` hat keinen Aufrufer mehr außer seinen Tests (löschen oder lassen).
- `einstellungen/integrationen/ads-conversion/page.tsx:213` und `integrationen/page.tsx:479`: Knopf/Link "Conversion-Einstellungen ..." (FX-V3, damit Toast und Knopf gleich heißen).

## Migration

- Keine.

## Offene Entscheidungen für Karam

- Keine. Bewusst beibehalten: ein erfolgreicher Login setzt den Fehlversuchszähler der Adresse nicht auf 0, er zählt nur selbst nicht (wie bisher).

## Nicht getestet

- Kein Live-Klick auf `/login` (Sperre hätte localhost für alle Sitzungen blockiert); Login-Logik per Unit-Test mit Nebenläufigkeit, SQL per `RATE_LIMIT_DB_TEST=1` gegen die lokale DB (40 parallele Reservierungen = 10, Rückgabe, Fensterwechsel).
- Während laufender Argon2-Prüfungen halten auch spätere Erfolge kurz einen Platz: mehr als 30 gleichzeitige richtige Anmeldungen hinter einer IP im selben Moment (rund 100 ms) würden kurz "Zu viele falsche Anmelde-Versuche" sehen. Nur theoretisch.
- Bereits gespeicherte Google-Bewertungslinks wurden nicht gegen die strengere Regel geprüft; `api/review-tokens/[token]` prüft beim Abruf erneut und lässt einen nicht mehr erlaubten Link weg. Ortsnamen mit wörtlichem `%` (`%25`) werden jetzt abgewiesen.
- Archivieren und Toast-Texte nur per Unit-Test, nicht im Browser.
