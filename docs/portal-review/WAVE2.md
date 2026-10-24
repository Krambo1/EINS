# Welle 2: weitere Prüfblickwinkel

Stand 2026-10-07. W1-W3 von Karam freigegeben und gestartet (2026-10-07), W4-W6 nach INT, W7 in der Schlussprüfung (Neon-Probe noch ohne Freigabe). Lesende Prüfer: Sonnet. Fixes danach: ein Executor, sequenziell nach INT-A/INT-B.

| # | Blickwinkel | Warum | Wann |
|---|---|---|---|
| W1 | Mandantentrennung bei Schreibzugriffen | Smoke prüft nur eine Seitenansicht. Jede Server-Aktion und API-Route mit fremder Id prüfen. Lokal gefunden: `clinic_notices`, `email_send_log`, `email_suppression` haben `clinic_id`, aber kein RLS; `guarantee_clocks`, `guarantee_delays`, `guarantee_candidate_rejections`, `response_enforcement_events` haben RLS ohne Policy (App-Rolle sieht nichts). Dazu die neue Angriffsfläche dieser Runde (Cron-Routen, CSV-Export, DSGVO-Löschung, Link-POST, 24-h-Geheimnis), die WS6 zur Prüfung offen gelassen hat. | sofort (nur lesen) |
| W2 | Garantie-Regeln gegen KANON | 90 Tage ab Unterschrift, Verlängerung nur nach Verzugs-Mail, erste Rechnung nur über EINS-Messweg, Selbstauskunft und KI-Score lösen nie aus. Hier hängt Geld dran. | sofort (nur lesen) |
| W3 | Patientendaten-Flüsse (DSGVO) | Wohin gehen Name, Telefon, Behandlung: Logs, Mail-Texte, Resend, URLs, R2-Links, Fehlerberichte. Erreicht die Löschung alle Stellen? | sofort (nur lesen) |
| W4 | Klick-Test der Kernwege im Browser | Bisher nur GET-Abrufe, keine Formular-Absendung live. Zielseite → Anfrage → Mail → Login per Link → Status, Kontaktversuch, Wiedervorlage → CSV. Admin: Praxis anlegen → Einladung → Passwort → Onboarding → Upload. Auch bei 375 px. | nach INT |
| W5 | Echte Datenmengen | Dashboard liest seit WS5 live aus den Quelltabellen. Mit 20.000 Anfragen und 50 Praxen messen, `EXPLAIN ANALYZE` der teuersten Abfragen, fehlende Indizes. | nach INT |
| W6 | Zeitumstellung 25.10.2026 | In 18 Tagen. Berliner Tagesgrenzen, 48 Werkstunden, 2-h-Überfällig, 90-Tage-Frist und Cron-Zeiten über den 25-Stunden-Tag als Tests. | nach INT-B |
| W7 | Produktions-Build + Migrationsprobe | `next build` für Portal und Zielseiten (Dev zeigt Build-Fehler nicht). 0077-0087 auf einem Neon-Branch der Produktion probeweise einspielen (braucht Freigabe). | in der Schlussprüfung |

## Entscheidungen Karam (2026-10-07)

- Messwege Anruf/Buchung (K-4): noch offen. Nichts bauen; Admin-Garantieseite zeigt "Messwege live: nur Formular".
- Aufbewahrung (L-4): ja, wie vorgeschlagen. Spam-Anfragen nach 90 Tagen löschen; Klick-Kennungen nach 90 Tagen leeren; archivierte Praxis 90 Tage nach Archivierung automatisch löschen (Export vorher bereitstellen); Anfragen ohne Termin und Behandlung nach 24 Monaten anonymisieren (Name, E-Mail, Telefon, Nachricht, Freitext auf NULL, Zähler bleiben). Läuft über `/api/cron/daily`.

## Fix-Welle 2 (nach INT-A/INT-B)

Reihenfolge: FX-G und FX-D parallel (getrennte Dateien), danach FX-C, danach WS10 (Copy), danach Verifier. Logs: `fixes/FX-G.md`, `fixes/FX-D.md`, `fixes/FX-C.md`. Befunde der anderen Sitzung (L-2, Teile von L-3/L-8, pvs_*-RLS) nur unter "Braucht andere Datei" melden.

| Fixer | Befunde | Dateien (Besitz) | Mig. |
|---|---|---|---|
| FX-G Garantie | K-1, K-2, K-3, K-4 (nur Admin-Hinweis "Messwege live: nur Formular"), K-7, K-9, K-13 (Hinweis), K-14, K-16, K-17, K-11, K-15 (Text), K-18 | `lib/{guarantee-clock,response-time,werkstunden}*.ts`, `server/{guarantee-clock,response-enforcement,request-notify}.ts`, `admin/garantie/**`, `admin/rueckruf/**`, `server/queries/admin.ts` (nur Garantie-Zähler), `(portal)/faq/content.ts`, `server/reports/monthly-pdf.tsx` | 0089 |
| FX-D Daten und Speicher | L-4 (Aufbewahrung, entschieden), L-3, L-11, L-12 + J-5 (Präfix-Löschung im Storage-Adapter), J-1, J-3 + J-9 (RLS/REVOKE, vorher Grep, dass kein App-Rollen-Pfad bricht), J-7, K-5 (Bewertung per `after()`), L-6 (Portal-Seite und Zielseiten-Übergabe), L-8 (eigene Dateien), L-13, L-14 | `worker/processors/{purge-audit,db-backup,ai-score,score-rules,review-request,email-send}.ts`, `server/{storage,dsgvo,uploads,leads,meta-pages,audit}.ts`, `server/email/templates/new-request.ts`, `api/cron/daily/**`, `api/leads/intake/**`, `api/webhooks/{meta,resend}/**`, `db/client.ts`, `lib/constants.ts` (nur Fristen), clinic-landing `lib/portal-intake.ts`, `app/api/lead/route.ts` (nur Einwilligungsfelder) | 0088 |
| FX-C Oberfläche und Zielseiten | L-1, L-5 (Such-API per POST), J-6, J-4 (Prüfung beim Speichern), J-8, K-20 (Kontaktversuch per E-Mail/WhatsApp vermerken), L-7 (neutrale Seitenadresse wie Meta-Pixel), L-9, L-16 | `(portal)/_components/GlobalSearchDialog.tsx`, `api/search/**`, `api/auth/logout/**`, `(auth)/login/link/**`, `api/auth/callback/**`, `(portal)/einstellungen/actions.ts` (nur J-4), `(portal)/anfragen/[id]/**` (nur K-20), `api/review-tokens/**`, clinic-landing `components/tracking/**`, `lib/doi.ts`, `lib/crm/**`, `lib/portal-review-tokens.ts`, `app/api/lead/**` (nach FX-D) | - |

Nicht in Welle 2 (Backlog oder Entscheidung): K-6 (Mitwirkungsfristen modellieren), K-8 (Folgen bei Fristende), K-10 (Messweg für die Praxis sichtbar), K-12, K-19 (Dokumentnotiz `06-garantie.md`), L-10 (eigene Absenderadresse, DECISIONS C10), L-15, L-2 (andere Sitzung).

## INT-C (nach FX-C und FX-D, ein Fixer)

Aus `fixes/FX-G.md` und `fixes/INT-A.md`, Abschnitte "Braucht andere Datei":
1. `server/queries/response-time.ts` (`responseCountsForPeriod`): `ruleStart` je Praxis aus `responseRuleStartForClinic`, damit die Monatsauswertung Anfragen vor der Unterschrift nicht als "nicht beantwortet" zählt (K-3).
2. `(portal)/anfragen/[id]/page.tsx` (`responseInfo`) und `anfragen/_components/ResponseFlagBadge.tsx`: `ruleStart` der Praxis übergeben (K-3).
3. `admin/_components/LeadsTable.tsx` (`ResponseFlag`) mit `responseRuleStartsByClinic`; `admin/_components/AttentionCard.tsx`: Zeile "N Praxen ohne Unterschriftsdatum, keine Uhr läuft" aus `garantieWithoutSignedOn` (K-9).
4. Störungs-Mitteilung (K-7 Teil 2): `NoticeKind` um `stoerung` in `server/clinic-notices.ts`, Text in `server/email/templates/clinic-notice.ts`, Migration `0090` für `clinic_notices_kind_check`, Sendeknopf auf der Admin-Garantieseite.
5. `(portal)/einstellungen/integrationen/setup/csv/page.tsx`: `export const maxDuration = 60` (A10).
6. **Fehler (aus FX-D-Test):** `server/request-notify.ts` loggt "operator candidate check failed ... reading '0'" bei einer Praxis ohne Garantie-Uhr (vermutlich durch FX-G K-9). Ursache finden, Test dazu.
7. `server/request-notify.ts` (L-13): an `renderNewRequestEmail` `treatmentFromCatalog` und den Katalognamen übergeben (siehe `fixes/FX-D.md`).
8. L-8: `server/audit.ts:108`, `auth/session.ts:296`, `api/auth/google/callback/route.ts:85`: Fehler über `describeErrorForLog` loggen. L-14: `(auth)/login/actions.ts:195-200` E-Mail im Audit durch Domain + kurzen Hash ersetzen.
9. `api/integrations/meta/callback/route.ts` (J-1): Fehlercodes `meta_page_ambiguous_multiple_pages` / `meta_page_bound_to_other_clinic` als deutsche Sätze für die Praxis (Wortlaut in `fixes/FX-D.md`).
10. `admin/clinics/[id]/dsgvo/**` (L-12): Erfolgsmeldung um Sicherungsfrist und Drittanbieter-Satz ergänzen; `prefixFailed !== 0` als unvollständig zeigen.
11. `lib/env.ts`: `R2_BACKUP_BUCKET`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` optional ins Schema. `server/ops-alerts.ts`: Präfix "[EINS PVS]" und PVS-Link nur für PVS-Alarme, sonst "[EINS Portal]".
Nicht in INT-C: `docker/postgres/init/01-extensions.sql` (nur lokal), Einwilligungen in der Anfrage-Ansicht (optional), Meta-Seitenauswahl (Entscheidung), L-2 (andere Sitzung).
