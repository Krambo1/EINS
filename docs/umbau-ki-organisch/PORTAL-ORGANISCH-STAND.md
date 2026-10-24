# Portal organisch: Bau-Stand

**Zweck:** Wiederaufnahme ohne den Chat. Plan: `PORTAL-ORGANISCH-BAUPLAN.md`, Analyse: `PORTAL-ORGANISCH.md`. Nach jeder Phase aktualisieren.

**Regeln:** kein Commit, kein Deploy, keine Migration auf Neon. Migrationen nur lokal (Docker `eins-postgres`). Geteilter, ungesicherter Baum: vor jedem Edit neu lesen.

## Step 0: Entscheidungen (Karam, 08.10.2026)

| ID | Entscheidung |
|---|---|
| D1 | Anruf-Tracking: **Matelso**. Adapter bauen. |
| D2 | Buchungslink: **Calendly** (UTM im Webhook `invitee.created`, bezahlter Tarif nötig). Adapter bauen. |
| D3 | Instagram-Direktnachrichten beantwortet das **Praxisteam**. EINS automatisiert nur Stichwort → Link. |
| D4 | Veröffentlichen **manuell mit Permalink**. API später, nicht in diesem Plan. |
| D5 | Beitragscode: vom Portal erzeugt, opak, **5 Zeichen ohne Vokale**. |
| D6 | Der opake Beitragscode (`utm_content`) **bleibt in der URL**, nur wenn er dem Code-Muster entspricht. Alles andere wird weiter entfernt. |
| D7 | Freigabe **per E-Mail und im Portal gleichzeitig**: Die Wochen-Mail mit signierten Ein-Klick-Links geht immer raus, und dieselben Knöpfe stehen auf `/beitraege`. Es gilt die erste Entscheidung. (Karams Antwort "Email und Portal", statt eines Umschalters pro Praxis.) |
| D8 | Routen freigegeben: Portal `/beitraege`, öffentlich `/freigabe/[token]`, Admin `/admin/clinics/[id]` Tab "Beiträge", Admin `/admin/beitraege`, clinic-landing `[clinicSlug]/page.tsx`, Webhook `/api/webhooks/messweg/[provider]`. |
| D9 | 2-Werktage-Freigabefrist überspringt die **Feiertage aller 16 Länder** (wie die 48-Werkstunden-Frist in `lib/werkstunden.ts`). Ein Verzug beginnt so nie zu früh. Keine neue Spalte `bundesland`. |

## Phasen

| Phase | Stand |
|---|---|
| 1 Quellen-Vokabular und Attributionsfelder | fertig lokal (Migration, Backfill, DB-Tests grün) |
| 2 Messwege Anruf und Buchung | fertig lokal (DB-Test grün); Browser offen |
| 3 Beiträge, Link-Baukasten, Startseite | fertig lokal, geprüft (Sonnet-Prüfer, 1 Korrekturrunde); Browser offen |
| 4 Freigabe, Verzug, Klon, Prüf-Schranke | fertig lokal, geprüft (Sonnet-Prüfer, 1 Korrekturrunde); Browser und echte Mail offen |
| 5 Auswertung pro Beitrag, Bildschirme ohne Anzeigen | offen |
| 6 Selbstauskunft und Eingabe am Empfang | fertig lokal, geprüft; Auswertungs-Aufschlüsselung kommt mit 5; Browser offen |
| 7 Instagram-Zahlen | offen |
| 8 Brücken für VALIDATE und SCALE | offen |

## Migrationen (nur lokal)

| Nr. | Datei | Phase | Lokal angewendet |
|---|---|---|---|
| 0097 | `0097_organic_attribution_fields.sql` | 1 | ja, 08.10.2026 (Backfill: 47 Patienten) |
| 0098 | `0098_messweg_anruf_buchung.sql` | 2 | ja, 08.10.2026 |
| 0099 | `0099_content_items.sql` | 3 | ja, 08.10.2026 |
| 0100 | `0100_messweg_claim_read_only_grants.sql` | 2/3 Korrektur | ja, 08.10.2026 |
| 0101 | `0101_content_approval_clone.sql` | 4 | ja, 09.10.2026 |
| 0102 | `0102_requests_consent_nullable.sql` | 6 | ja, 09.10.2026 |

## Externe Schritte für Karam

- Meta App Review für die Instagram-Berechtigungen (Phase 7), sofort starten, Vorlauf Wochen.
- Matelso: Konto und Nummern-Pool bestellen.
- Calendly: bezahlter Tarif mit Webhooks, Webhook-Signaturschlüssel.
- Nach Freigabe: Deploy und Migrationen auf Neon.
- Pro neuer Praxis: Instagram-Profikonto, Profil-Link auf die Startseite, Tracking-Nummer im Profil.

## Offene Punkte

- KANON 6a nennt den Eintrag am Empfang nicht. Umgesetzt: "Anfrage anlegen" zählt als Kontakt zum Zeitpunkt des Eintrags (die Person ist schon im Gespräch mit der Praxis). Karam: KANON 6a bei Gelegenheit um diesen Satz ergänzen oder anders entscheiden.

- Lokal mit angewendet: 0096 (`outreach_videos_obsidian_ref`, aus einer anderen Session). Auf Neon fehlen 0096 bis 0102.
- DB-Tests brauchen `DATABASE_URL` aus `.env.local` im Shell-Env (die vitest-Vorgabe ist ein Platzhalter). Alle 10 DB-Testdateien grün am 08.10.2026.
- `messweg_events` ohne Praxis (`ohne_praxis`, clinic_id NULL) bleiben bei Praxis-Löschung stehen (nur letzte 4 Ziffern der Nummer). Aufbewahrung dafür noch nicht in `purge-retention`.
- Nach Migration 0097 (lokal und später auf Neon): `pnpm --filter portal backfill:first-touch --apply` (füllt `patients.first_touch_channel`).
- Env für Messwege: `MATELSO_WEBHOOK_TOKEN` (min. 32 Zeichen), `CALENDLY_WEBHOOK_SIGNING_KEY`, lokal `MESSWEG_FIXTURE_SECRET`. Matelso-Push-Vorlage steht in `lib/messweg-adapters.ts` (`MATELSO_PUSH_TEMPLATE`), Header `X-EINS-Messweg-Token`.
- Calendly: Ereignistyp-URI (`https://api.calendly.com/event_types/...`) pro Buchungslink im Admin-Tab Messwege eintragen.

## Log

- 09.10.2026: Prüfung Phase 4+6 (Sonnet): 11 von 13 bestätigt. Korrigiert: Widerruf stoppt nicht veröffentlichte Klon-Beiträge sofort und zieht offene Freigaben zurück (live bleibt "zu stoppen", kein Permalink mehr), Löschpflicht nach Widerruf sofort fällig und auf dem Admin-Start sichtbar (auch ohne Vertragsende), Verzug-Job nur solange die Garantie-Uhr läuft, kein Freigabe-Paket ohne entscheidungsberechtigten Zugang, Selbstauskunft auf der Zielseite kostet nie die Anfrage. Seed legt Beispiel-Beiträge in jedem Status an.

- 09.10.2026: Phase 6: Zielseite fragt optional "Wie sind Sie auf uns aufmerksam geworden?" (Chips im Kontaktschritt, geschlossene Liste), Portal `/anfragen/neu` ("Anfrage anlegen", Quelle manuell, Praxis-Eingabe, 30-Tage-Regel als Notiz statt Messweg-Aktivität), FAQ neu. Kern-Korrekturen: keine "Neue Anfrage"-Mail für eigene Einträge, Empfangs-Eintrag zählt als Kontakt (Antwortzeit), Anruf/Buchung/Empfang speichern keine erfundene DSGVO-Einwilligung mehr (0102, `dsgvo_consent_at` NULL, Anzeige "Keine (Anruf, Buchung oder Eintrag am Empfang)"). Phase 4 Klon: `clone_records`-Tab, Modell nur mit Einwilligung und Trainings-Widerspruch, Widerruf markiert Klon-Beiträge "zu stoppen" + Mail an EINS, Admin-Start mit Aufgaben "Beiträge zu stoppen" und "KI-Klon löschen".

- 09.10.2026: Phase 4 Kern: Prüf-Schranke `canSubmitForApproval` (HWG-Prüfung zum aktuellen Text, Hinweise namentlich bestätigt, „KI-generiert“, Bestätigung keine Vorher-Nachher/KI-Patientin/KI-Ergebnis, gültiger Klon-Nachweis), Frist 2 Werktage ohne Feiertage aller Länder (`approvalDueAt`), Freigabe nur Inhaber+Marketing, Klon-Beiträge nur Inhaber. D7 ersetzt den Umschalter pro Praxis aus dem Plan: Mail und Portal immer beide, erste Entscheidung gilt. Phase 6 parallel gestartet (Dateien getrennt).

- 08.10.2026: Prüfung Phase 1-3 (Sonnet): 11 von 13 Aussagen bestätigt. Korrigiert: Anbieter-Ratenlimit des Messweg-Webhooks zählt erst nach der Echtheitsprüfung (vorher per IP), Körpergrenze in Bytes, verwaiste Ingest-Sperre wird nach 180 s vom nächsten Versuch übernommen (`in_arbeit`, 503 während ein Lauf arbeitet), `eins_app` hat auf den neuen Praxis-Tabellen nur noch SELECT (0100), Intake lehnt `anruf`/`buchung` ab (nur die Webhooks schreiben sie). Offen gelassen: Ein Anruf oder eine Buchung derselben Person innerhalb 30 Tagen nach einer Meta- oder manuellen Anfrage wird Aktivität, zählt also nicht als Messweg (vorsichtig zugunsten der Praxis).

- 08.10.2026: Phase 1: ein Quellen-Vertrag `lib/sources.ts` (8 Eingangsquellen, Aliase, Zuverlässigkeit messweg/plattform/selbstauskunft/praxis_eingabe/unbekannt, geschlossene Selbstauskunft-Liste), Intake akzeptiert nur noch diese Quellen, `ttclid`, Erstkontakt-Kanal am Patienten. Migration 0097 mit Backfill.
- 08.10.2026: Phase 2: Tabellen Tracking-Nummern, Buchungslinks, Messweg-Ereignisse (0098), Webhook `/api/webhooks/messweg/[provider]` mit Adaptern Matelso (Token), Calendly (Signatur, 180 s), Fixture. 30-Tage-Regel: dieselbe Person wird Aktivität statt neuer Anfrage. Buchung setzt Status "Termin vereinbart". Admin-Tab Messwege, Checkliste zeigt Nummern und Links.
- 08.10.2026: Phase 3 Kern: Beitragscode (`lib/post-code.ts`), Link-Baukasten (`lib/content-links.ts`), Statusregeln (`lib/content-status.ts`, Freigabe nur durch die Praxis), Tabellen 0099, Intake ordnet `utm_content` dem Beitrag zu.
