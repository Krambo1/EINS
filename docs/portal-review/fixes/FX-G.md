# FX-G: Garantie-Logik (Fix-Welle 2)

| ID | Ergebnis | Dateien | Was und warum |
|---|---|---|---|
| K-11 | fixed | `src/app/(portal)/faq/content.ts` | Satz umgestellt: "Am Tag der ersten qualifizierten Anfrage über EINS beginnt Ihr erster bezahlter Leistungsmonat." steht jetzt vor dem 90-Tage-Satz, beide Grenzen bleiben im selben Absatz. |
| K-15 | fixed (nur Text) | `src/app/(portal)/faq/content.ts` | Vertragswortlaut "am Sitz Ihrer Praxis" bleibt, ergänzt um den Satz, dass das Portal zu Gunsten der Praxis jeden Feiertag eines Bundeslands auslässt; Rechnung unverändert (die sichere). |
| K-18 | fixed | `src/server/reports/monthly-pdf.tsx` | Gedankenstriche raus: Titel "Praxis, Monat", Platzhalter "k. A."; Kommentar-Gedankenstriche ebenfalls ersetzt. |
| K-1 | fixed | `src/lib/guarantee-clock.ts`, `src/lib/guarantee-clock.test.ts`, `src/app/admin/garantie/actions.ts`, `src/app/admin/garantie/[clinicId]/page.tsx` | `computeDeadline` nimmt Spannen nach `notifiedOn` geordnet und zählt eine nur, wenn die Mitteilung spätestens am damals geltenden Fristende ging (Fristtag zählt noch); Test 189 umgedreht. Alle Mitteilungswege (Verzug eintragen mit Senden oder eigenem Datum, Störung mit Datum, "Selbst gesendet", "Mitteilung senden") verweigern mit "Mitteilung nach Fristende zählt nicht mehr."; "Mitteilung senden" prüft vor dem Versand. |
| K-2 | fixed | `src/lib/guarantee-clock.ts`, `src/app/admin/garantie/actions.ts`, `src/app/admin/garantie/[clinicId]/page.tsx`, `src/server/request-notify.ts` | `eligibleInquiries` liefert `hasContactData` und `isSpamMarked`; `confirmInquiryAction` verweigert ohne Telefon/E-Mail, bei Spam-Status und bei früherem offenen Kandidaten (außer Checkbox "bewusst übersprungen" plus Pflichtnotiz, beides im Audit). Seite zeigt den Grund statt des Knopfs, Spam-Badge; Kandidatenmail nur noch für Kandidaten mit Kontaktdaten. |
| K-13 | fixed (Hinweis) | `src/server/guarantee-clock.ts`, `src/app/admin/garantie/page.tsx` | Übersicht zeigt ab 30 Tagen "Verzug seit N Tagen offen" (`oldestOpenDelayDays`); keine Obergrenze im Code, Entscheidung bleibt bei Karam. |
| K-16 | fixed | `src/app/admin/garantie/actions.ts` | `undoRejectionAction`, `setManualEndAction`, `clearManualEndAction` laufen mit `auditTx` in einer Transaktion; Bestätigen hat `manual_end_state IS NULL`, Ende setzen hat `qualifying_inquiry_on IS NULL AND manual_end_state IS NULL` im `WHERE`, beide prüfen `returning` und melden deutsch statt CHECK-500. |
| K-17 | fixed | `src/app/admin/garantie/actions.ts` | `setSignedOnAction` sperrt Datumsänderung nach vermerktem Rechnungsversand und prüft die bestätigte Anfrage mit `checkConfirmable` gegen die neue Frist. |
| K-3 | fixed | `src/lib/response-time.ts`, `src/server/response-enforcement.ts`, `src/server/guarantee-clock.ts`, `src/lib/guarantee-clock.ts`, `src/app/admin/garantie/**`, `src/server/reports/monthly-pdf.tsx`, `src/db/migrations/0089_guarantee_test_reason.sql` | Regelstart je Praxis = Berliner Mitternacht von `signed_on` (nie vor 06.10.2026, `responseRuleStartFor`, optionales `ruleStart` an `ResponseInput`); Rückruf-Lage (Folge 3, Warnzählung) und Garantie-Seite nutzen ihn, Rückruf-Lage blendet zusätzlich als `test_eintrag` abgelehnte Anfragen aus. Kandidatenfenster war schon ab Berliner Mitternacht (Karams Entscheidung), jetzt per Test belegt; kein Hinweis "Uhrzeit prüfen", weil entschieden. Neuer Ablehnungsgrund "Test der EINS-Seite, keine echte Person" mit Migration 0089 (lokal angewendet). Portal-Badges, Admin-Anfragenliste und Monatsauswertung brauchen den Regelstart noch in fremden Dateien (siehe unten). |
| K-4 | fixed (nur Hinweis) | `src/app/admin/garantie/[clinicId]/page.tsx` | Unter "Erste qualifizierte Anfrage" steht "Messwege live: nur Formular. Anruf und Buchung werden noch nicht erfasst." Nichts für Anruf/Buchung gebaut (nicht entschieden). |
| K-7 | fixed (teilweise) | `src/app/admin/garantie/actions.ts`, `src/app/admin/garantie/[clinicId]/page.tsx` | "Selbst gesendet": Datum nicht in der Zukunft, nicht vor dem Zeitraum, gesperrt bei `notice_id` (aus dem Portal gesendet), Pflichtfeld "Beleg" (ins Audit); dieselben Prüfungen plus Beleg-Pflicht beim Eintragen von Verzug/Störung mit eigenem Datum. Mitteilungsmail enthält jetzt "Die 90-Tage-Frist endet damit am TT.MM.JJJJ" (bei offenem Verzug "Stand heute ..."). Nebenbei behoben: "Mitteilung senden" nannte als Erfüllungstag den Tag nach der Erfüllung (`toDate + 1`). Offen: Sendeweg für Störungen und abweichende Vertragsadresse (fremde Dateien, siehe unten). |
| K-9 | fixed | `src/server/queries/admin.ts` (nur `adminAttentionCounts`), `src/server/guarantee-clock.ts`, `src/server/request-notify.ts` | Aktive Nicht-Demo-Praxen ohne Unterschriftsdatum zählen im Garantie-Badge (`garantieWithoutSignedOn`, `clinicSlug` in der Übersicht). Messweg-Anfrage bei Praxis ohne Uhr schickt Karam "Praxis hat kein Unterschriftsdatum" (idempotent je Anfrage); fehlt jede Empfängeradresse, wird geloggt (nur IDs) statt still zurückzukehren. |
| K-14 | fixed | `src/app/admin/rueckruf/actions.ts`, `src/app/admin/rueckruf/page.tsx`, `src/lib/response-time.ts` | Ereignis wird zuerst geschrieben, dann die Warnung gesendet und die Notiz ergänzt; erreicht die Mail niemanden, rollt die Transaktion zurück. Warntext: "Die 48 Werkstunden sind keine Bedingung der Garantie." Pause nur mit Pflicht-Haken "Bezahlte Anzeigen laufen für diese Praxis" (serverseitig geprüft). |

## Tests ergänzt

- `src/lib/guarantee-clock.test.ts`: Test 189 umgedreht (alter Fall "Mitteilung im Fenster" bleibt als eigener Test), K-1 (Mitteilung Tag 95, am Fristtag, Kette über verlängerte Frist, zweite zu spät), K-13 offener Verzug 400 Tage, `verzugRange`-Ränder, DST 25.10.2026 (Frist, Tag 90/Ende, beide 02:30, Berliner Tagesgrenzen, Scan-Bereich, Bestätigen am Folgetag), Frühjahr 28.03., K-2 (Kontaktdaten, Spam, frühere Anfrage, Überspringen), K-3 (vor Mitternacht der Unterschrift raus, Grund `test_eintrag`).
- `src/lib/werkstunden.test.ts`: 48 Werkstunden über den 25-Stunden-Tag (Fr 23.10. 12:00 MESZ gibt Fr 30.10. 15:00 MEZ), Sa-Abend-Eingang gibt Mo 02.11. 12:00, `endOfNextWerktag` über Umstellung, Allerheiligen und Weihnachten, Werktag NRW gegen Feiertag irgendeines Landes.
- `src/lib/response-time.test.ts`: Regelstart je Praxis (vor/nach Unterschrift, Fallback 06.10.), Monatszählung `vorRegel`, Folge 3 mit Heilfrist über die Umstellung, Warntext.
- `src/server/guarantee-clock.test.ts`: `todayBerlin()` mit Serverzeit UTC am 24./25.10.

Ergebnis: `npx tsc --noEmit -p .` sauber; `npx vitest run src/lib src/server src/app/admin` 57 Dateien, 682 Tests grün (3 DB-Tests übersprungen wie vorher).

## Braucht andere Datei

- `src/server/queries/response-time.ts` (`responseCountsForPeriod`, Monatsauswertung): je Zeile `ruleStart: await responseRuleStartForClinic(clinicId)` aus `@/server/guarantee-clock` mitgeben, sonst zählt die Monatsauswertung Anfragen vor der Unterschrift als "nicht beantwortet" (K-3).
- `src/app/(portal)/anfragen/[id]/page.tsx` (Zeile ~185, `responseInfo`) und `src/app/(portal)/anfragen/_components/ResponseFlagBadge.tsx` (INT-B): `ruleStart` der Praxis übergeben (`responseRuleStartForClinic`), damit Anfragen vor der Unterschrift kein Badge "Von der Praxis nicht beantwortet" bekommen (K-3).
- `src/app/admin/_components/LeadsTable.tsx` (`ResponseFlag`): dasselbe mit `responseRuleStartsByClinic`. `src/app/admin/_components/AttentionCard.tsx`: Zeile für `garantieWithoutSignedOn` ("N Praxen ohne Unterschriftsdatum, keine Uhr läuft") (K-9).
- `src/server/clinic-notices.ts` (`NoticeKind` um `stoerung`), `src/server/email/templates/clinic-notice.ts` (`stoerungNoticeText`) und eine Migration, die `clinic_notices_kind_check` um `'stoerung'` erweitert: Sendeknopf für Plattform-Störungen (K-7 Teil 2). `noticeRecipients`: Abgleich mit der im Hauptvertrag bezeichneten Adresse, braucht ein Feld je Praxis (K-7 Teil 3).

## Migration

- `0089_guarantee_test_reason.sql`: CHECK `guarantee_rejections_reason_check` um `'test_eintrag'` erweitert (DROP IF EXISTS + ADD, idempotent, alle alten Werte bleiben). Lokal mit `pnpm --filter portal db:migrate` angewendet. 0088 (FX-D) lag beim Lauf noch nicht vor; der Runner warnt dann nur über die Reihenfolge, die beiden Dateien hängen nicht voneinander ab. Kein Drizzle-Spiegel nötig (schema.ts hat für diese Tabelle keinen CHECK).

## Offene Entscheidungen für Karam

- Praxis ohne Unterschriftsdatum: Die 48-Werkstunden-Regel gilt dort weiter ab 06.10.2026 (bisheriges Verhalten). Alternative: ohne Datum gar keine Frist. Ich habe den bisherigen Stand gelassen.
- Testanfrage nach der Unterschrift: Die Ablehnung "Test der EINS-Seite" nimmt sie aus der Rückruf-Lage, aber das Badge in der Anfragenliste der Praxis und die Monatsauswertung zählen sie weiter, bis die Praxis sie auf "Spam" setzt. Soll die Ablehnung als Test den Status der Anfrage im Auftrag auf "Spam" setzen?
- K-4 Anruf/Buchung, K-7 abweichende Vertragsadresse: weiterhin offen.

## Nicht getestet

- Serveraktionen (`garantie/actions.ts`, `rueckruf/actions.ts`) nur per Typprüfung, nicht gegen eine echte DB und nicht im Browser geklickt (Fälle 17 bis 20 aus `## Fehlende Tests` bleiben offen; es gibt kein Testgerüst für Serveraktionen mit `redirect`).
- Kandidaten- und "kein Unterschriftsdatum"-Mail nicht real versendet.
- SQL-Ausschluss `test_eintrag` in `response-enforcement.ts` nicht gegen echte Zeilen geprüft.
