# BRIEF: Asset-Liefer-Checkliste im Portal (Kunden-Onboarding)

Single source of truth für dieses Projekt. Bei Konflikt: erst fragen, dann ändern.

## Goal

**E-Mail-Pingpong beim Onboarding ersetzen.** Die Praxis liefert alle Assets aus der Obsidian-Checkliste über das Portal (Häkchen, Uploads, Link-Felder, Angaben), EINS sieht im Admin pro Praxis sofort, was fehlt. Dazu:

1. **Interaktive Checklisten-Seite** im Kundenportal (neuer Schritt in "Erste Schritte"), mit klarer Anleitung **pro Punkt, WIE geliefert wird** (Einladung, Upload, Link, Angabe).
2. **Admin-Sicht** pro Praxis mit zweistufigem Status (geliefert → von EINS geprüft).
3. **Statisches PDF "Asset-Liefer-Checkliste"** im Dokumente-Tab, gepinnt wie die Portal-Anleitung.

Quelle des Inhalts: Obsidian-Notiz `10 EINS/Kunden/Asset-Liefer-Checkliste (Kunden-Onboarding).md` im Vault `D:\Desktop\Claude\Obsidian\Karam`, Blöcke A-F. Block G (laufende Mitwirkung) ist keine Lieferung und bleibt draußen bzw. nur als Hinweistext.

## Success criteria

- **Kein Asset per Mail nötig:** Jeder Punkt der Vault-Liste hat im Portal einen definierten Lieferweg (Einladung mit Schritt-für-Schritt-Anleitung, Portal-Upload, Link-Feld oder Texteingabe). Passwörter per Mail bleiben explizit verboten.
- **Admin-Übersicht:** Auf einen Blick pro Praxis: was offen, was geliefert, was geprüft; Blocker (Block A) hervorgehoben.
- **Zweistufig sauber:** Praxis-Aktion setzt "geliefert" (Upload/Link/Angabe automatisch, reine Aktionen wie Einladungen per Selbst-Haken), EINS bestätigt "geprüft" im Admin. Startrelevante Punkte (Block A) zählen erst geprüft als erledigt.
- **Dokumente-Tab:** PDF der Checkliste (für alle Praxen gleich, inkl. Lieferweg-Anleitungen) gepinnt verfügbar.

## Lieferwege (Kern-Designentscheidung, Karam 2026-06-12)

| Asset-Typ | Weg |
|---|---|
| Zugänge (Meta, Google Ads, GBP, GA/GTM, CMS, ...) | **Einladung/Partnerfreigabe** an EINS; Portal zeigt Schritt-für-Schritt-Anleitung + Selbst-Haken "Einladung verschickt". Keine Passwörter, nirgends. |
| Einzeldateien (Logo, CI-Dokument, Zertifikat-Scans, einzelne Fotos) | **Portal-Upload** (R2-Storage, `put()` existiert). |
| Große Sets (Foto-Archive, Videos) | **Link-Feld** (Drive/WeTransfer/Dropbox-Link eintragen) zusätzlich zum Upload. |
| Angaben (Behandlungsliste, Standorte, Team, Kapazität, Ansprechpartner, Routing-Nummer) | **Textfelder** im Portal. |
| Termin (Onboarding-Gespräch) und Klon-Aufnahme | Status-Punkt mit Hinweis (Terminbuchung läuft über Karam direkt; kein Kalender-Build). Die Klon-Aufnahme bestätigt die Praxis per Häkchen (A5), die unterschriebene Einwilligung für KI-Abbild und Stimme kommt als Upload (F5). |
| AVV | Status-Punkt; Dokument kommt von EINS (Dokumente-Tab, kind `avv`), unterschriebene Fassung als Upload zurück. |

## Constraints

- **Copy-Regeln** (CLAUDE.md): formales Sie, kein Em-Dash, "Praxis" nie "Klinik", Anti-Anglizismus, €, kein All-Caps, Klartext zuerst. Inhaber 40-65, non-technisch: jede Anleitung muss ohne Vorwissen funktionieren.
- **Die Vault-Notiz bleibt Master für den Inhalt** der Liste; das Portal ist die ausfüllbare Instanz. Strukturänderungen an Punkten fließen zurück in die Vault-Notiz.
- **Keine Überschneidung mit dem Discovery-Fragebogen** (Ziele/Markt/Zahlen = Fragebogen; Zugänge/Material/Infos/Freigaben = Checkliste).
- **Portal-Konventionen:** @eins/ui-Primitives, keine `bg-*/NN`-Opacity-Tokens, RLS-Muster der bestehenden Tabellen, `writeAudit`, bestehender Storage-Adapter.
- **Upload-Härtung:** Größenlimits, erlaubte Dateitypen (Bild/PDF/Vektor), clinic-scoped Storage-Keys; kein öffentlicher Lese-Zugriff auf Kunden-Uploads (signierte URLs).

## Non-goals

- Kein Kalender-/Terminbuchungs-Build (Termine bleiben bei Karam/Calendly).
- Keine automatische Verifikation von Zugängen (ob die Meta-Einladung wirklich ankam, prüft EINS manuell; v2-Idee).
- Kein E-Mail-Erinnerungs-/Eskalations-System in v1.
- Block G (Freigabe binnen 2 Werktagen, Profil-Link und Tracking-Nummer behalten, Antwortzeit 48 Werkstunden ohne Garantie-Bedingung mit drei Folgen, Schulung als Empfehlung, ...) wird nicht getrackt; nur als statischer Hinweis am Ende.
- Keine Mehrsprachigkeit, keine Zahnärzte-Variante.

## Key open assumptions

- **Platzierung:** eigene Seite `/onboarding/checkliste`, verlinkt als Schritt in "Erste Schritte" (analog Fragebogen).
- **Zugriff:** nicht Inhaber-only; auch Team-Rollen können liefern (Rezeption/Marketing lädt oft Logo/Fotos hoch). Abhaken sensibler Punkte (AVV) ggf. Inhaber-only.
- **EINS-Empfänger-Daten** (Business-Manager-ID, Einladungs-E-Mail für Google Ads etc.) kommen als Konstanten/env in die Anleitungstexte; Platzhalter bis Karam sie liefert.
- PDF-Generierung folgt dem Vertriebsleitfaden-Muster (@react-pdf, statisch ausgeliefert oder Seed).

## Decision log

- 2026-06-12: Ziel = E-Mail-Pingpong ersetzen; Lieferung über Portal, Status im Admin. (Karam, Interview)
- 2026-06-12: Dateiweg = Portal-Upload für Einzeldateien + Link-Feld für große Sets; kein Asset per Mail. (Karam, Interview)
- 2026-06-12: Status zweistufig: Praxis "geliefert", EINS bestätigt "geprüft"; startrelevante Punkte zählen erst geprüft. (Karam, Interview)
- 2026-06-12: Dokumente-Tab = statisches PDF, gepinnt wie Portal-Anleitung; kein DB-Eintrag pro Praxis. (Karam, Interview)
- 2026-06-12: Buckets genehmigt: 1 Item-Katalog → 2 Portal-Checkliste (DB+Seite) → 3 Admin-Tab → 4 PDF → 5 Notion-Rückfluss. (Karam)
- 2026-06-12: Bucket 1 geliefert: checkliste-v1.md, 33 Punkte (24 Pflicht, 5 Blocker) in Blöcken A-F, 6 Lieferweg-Typen, Anleitungstexte pro Punkt, 3 Platzhalter ({{EINS_META_BM_ID}}, {{EINS_ADS_EMAIL}}, {{EINS_UPLOAD_KONTAKT}}). Block G nur als statischer Schlusshinweis. Wartet auf Review.
- 2026-06-13: Bucket 2 (Portal-Checkliste DB + Kundenseite) geliefert + live verifiziert. Migration 0062 (zwei Tabellen: checklist_items mit zweistufigem Status offen/geliefert/geprueft/entfaellt + answer jsonb; checklist_files je hochgeladene Datei, eigene Tabelle wegen Parallel-Upload-Races + einzeln löschbar/herunterladbar; RLS clinic-scoped). content.ts = 33-Punkte-Katalog (IDs = Speichervertrag), EINS_CONTACT-Platzhalter via Template-Literals. actions.ts: saveChecklistItem/uploadChecklistFile/removeChecklistFile, computeDeliveryStatus pro Liefertyp, Re-Delivery setzt geprueft→geliefert zurück (No-op-Save behält Verifikation). Seite /onboarding/checkliste + ChecklisteForm (6 Controls), neuer Schritt in /onboarding. Upload-Härtung: 25 MB Cap, Extension-Allowlist je Profil (logo/dokument/bild), clinic-scoped Keys `${clinicId}/checklist/...`. **Scoping-Entscheidung:** Seite bleibt Inhaber-only (`onboarding.complete`) wie der Rest von /onboarding; `inhaber`/`team`-Rollen im Katalog kodiert für künftige v2-Delegation, aber kein Team-Zugang in v1 (Reversal = nur Permission-Swap). Live geprüft: alle 6 Control-Typen, Status-Übergänge, Upload, geprüft-Rendering, Re-Delivery-Reset, Fortschritt.
- 2026-06-13: Bucket 3 (Admin-Tab) geliefert. setChecklistItemVerifiedAction in admin/clinics/[id]/actions.ts (EINS setzt geprueft / nimmt zurück; nur auf geliefert/geprueft). ChecklisteTab.tsx (Blocker hervorgehoben, Antworten + Datei-Downloads, Verify-Forms). Admin-File-Route /api/admin/files/[...path] (requireAdmin, lokal Stream / R2 signierte URL). Tab in admin/clinics/[id] verdrahtet. Typecheck clean; geprueft-Zustand (gleiche Spalten/Werte wie die Action schreibt) clinic-seitig live verifiziert; Admin-UI selbst nicht live (Admin-Auth/Host-Setup im Sandbox nicht praktikabel).
- 2026-06-13: HINWEIS Verifikation: dev-DB (Infisical env=dev) war leer; `pnpm db:seed` ausgeführt (TRUNCATE + Demo-Praxis "Praxis Dr. Demo", inhaber@praxis-demo.de). Migration 0062 lokal angewandt. Offen: Bucket 4 (PDF im Dokumente-Tab) + Bucket 5 (Notion-Rückfluss); prod braucht `db:migrate` 0062; 3 EINS_CONTACT-Platzhalter vor Go-live ersetzen.
- 2026-06-14: Bucket 4 (statisches PDF im Dokumente-Tab) geliefert + live verifiziert. `src/server/reports/checkliste-pdf.tsx` = `generateChecklistePdf()` aus derselben `content.ts` (Single Source of Truth, driftet nie von der Portal-Checkliste); @react-pdf wie leitfaden-pdf.tsx, KEIN `import "server-only"` (läuft unter tsx). Aufbau: Cover + Lead (CHECKLISTE_INTRO) + Legende "So funktioniert die Lieferung" (ersetzt die interaktiven Controls im Druck, inkl. Passwort-Verbot) + Inhaltsverzeichnis A–F + pro Punkt eine Karte (ID+Titel, Badges Lieferweg/Pflicht-Empfohlen-Optional/Blocker, Anleitung mit erhaltenen Zeilenumbrüchen, Dateiformat-Hinweis, "Im Portal anzugeben", Warum) + Schlusskarte ABSCHLUSS_HINWEIS. WinAnsi: "→" wird zu "›" down-converted (einziger Nicht-WinAnsi-Glyph im Inhalt). CLI `scripts/generate-checkliste-pdf.ts` (npm-Script `pdf:checkliste`) schreibt DEFAULT nach `public/anleitung/eins-asset-checkliste.pdf` (statisches Asset, kein DB-Eintrag, wie Portal-Anleitung). Dokumente-Seite: der bisher hartcodierte Anleitung-`<li>` ist jetzt ein `PINNED_DOCS`-Array (2 Einträge, ClipboardCheck-Icon + "Checkliste"-Badge für die Checkliste), per `.map` gerendert; angepinnt nur im "Alle"-Tab, beim Kind-Filter ausgeblendet. Verifiziert: tsc clean; PDF 49 KB / 9 Seiten, alle 33 Punkte + Glyphen korrekt (€ rendert — A/B-Test gegen das Prod-Leitfaden-PDF zeigt: pdftotext lässt € bei beiden weg, reines Extraktions-Artefakt, kein fehlender Glyph); statisches Asset wird mit 200/application/pdf ausgeliefert; Dokumente-Seite zeigt beide Pins in Reihenfolge mit korrekten Öffnen/Herunterladen-Links + Download-Namen; Kind-Filter blendet beide Pins aus. **WICHTIG vor Go-live:** Das PDF backt die `EINS_CONTACT`-Werte zum Generierungszeitpunkt ein. Nach dem Ersetzen der 3 Platzhalter `pnpm --filter portal pdf:checkliste` neu laufen lassen und das PDF mitcommitten (das aktuell committete PDF enthält noch die Platzhalter-Texte).
- 2026-09-30: Umbau auf KI-Klon und "Keine Anfrage, keine Rechnung" (Karam, Kanon). A5 heißt jetzt "Klon-Aufnahme und Einwilligung geliefert" (ID bleibt, Blocker, nur Titel und Anleitung neu). F1 (Patienten-Einwilligungen für den Produktionstag) entfällt und wird nie wiederverwendet, F5 "Einwilligung KI-Abbild und Stimme" ist neu (Upload, Inhaber). Frist für Klon-Aufnahme, Einwilligung und Zugänge: 3 Werktage nach Unterschrift. Block G neu: Freigabe binnen 2 Werktagen, Profil-Link und Tracking-Nummer bleiben, 48 Werkstunden und Schulung nur noch als Empfehlung, Verzug verlängert die 90 Tage. Anzahl unverändert (33 Punkte, 24 Pflicht, 5 Blocker). Offen: Übergabeweg der Klon-Aufnahme, hängt an der Wahl des KI-Werkzeugs. Nicht geprüft: gespeicherte A5- und F1-Zeilen in der Prod-DB (kein Zugriff aus dieser Sitzung).
- 2026-09-30 (Nachtrag): D5 (Vorher-Nachher-Material) entfällt und wird nie wiederverwendet, ohne Nachfolger, weil Vorher-Nachher-Darstellungen nicht verwendet werden (Kanon Abschnitt 8). Stattdessen steht über Block D der Hinweis, keine Vorher-Nachher-Bilder hochzuladen. F6 "Einwilligungen für vorhandenes Material" ist neu (empfohlen, kein Pflichtpunkt, kein Blocker, "Keine vorhanden" erlaubt, Team und Patientinnen und Patienten). Eine neue Pflicht hätte bereits abgeschlossene Onboardings wieder geöffnet. Zählung unverändert (33 Punkte, 24 Pflicht, 5 Blocker). Offen: Vorlage für die Einwilligungen in vorhandenem Material. Nicht geprüft: gespeicherte D5-Zeilen in der Prod-DB. Notion, Portal, PDF und Dokument tragen denselben Inhalt.
- 2026-10-06: Antwortzeit (KANON 6a): Der Schlusshinweis "Was danach zählt" nennt die 48 Werkstunden jetzt als eigenen Punkt: keine Bedingung der Garantie, aber drei Folgen (Einwand fehlender Echtheit oder Erreichbarkeit ausgeschlossen, gesonderter Ausweis in der Auswertung, Anzeigen-Pause nach Warnung). Nur die Schulung bleibt reine Empfehlung. Fünf statt vier Punkte, Datei checkliste-v1.md, content.ts und PDF angepasst.
