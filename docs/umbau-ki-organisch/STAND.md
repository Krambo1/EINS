# Umbau-Stand (30.09.2026)

**Zweck:** Wiederaufnahme ohne den Chat. Wortlaut steht in `KANON.md`, die Karte in `PLAN.md`, die Regeln für Sub-Agenten in `AGENT-REGELN.md` (jeder Agent liest sie zuerst).

## Fertig (von Agenten gemeldet, noch nicht vom Prüf-Agenten bestätigt)

| Bereich | Stand |
|---|---|
| Lessons & Decisions | 11 Einträge vom 30.09.2026, alte als "Ersetzt" markiert |
| Neue Seite "KI-Inhalte: Regeln" | https://app.notion.com/p/3ebe7fc8873481f594b8ea276771e8ba |
| Leads-DB | Datumsfeld `Vorschau-Anzeigen` |
| Ad ideas, Ai integration | Klon als Kernformat, Verbotenes markiert |
| Angebot, EINS Grundlagen (v3.0) | umgestellt; `north-star.md`, `AGENTS.md`, `CLAUDE.md`, `context/01` gespiegelt |
| Garantie (intern) v2.0 | neu, v1.8 als Archiv-Unterseite; `context/06` gespiegelt; Lead-Tracking-Playbook mit Messwegen |
| Der ganze Prozess | komplett umgestellt |
| Sales Playbook, Lead Magnet Template | umgestellt; Closing-Leitfaden, Sales-deck-principles, case-study (jetzt Vorlage ohne erfundene Zahlen) |
| Onboarding/Willkommen | `welcometext.md`, PDF (19 Seiten). 01.10.: `welcometext.md` und PDF auf Lesbarkeit und Beruhigung umgebaut (kurzer Brief mit Kasten "Das gilt ab heute", danach "Ihre nächsten Schritte" und "Was Ihnen ab heute sicher ist"; Garantie, Geld, Unterlagen hinten), gegen KANON geprüft (Sonnet-Verifier, 8 Befunde behoben). Notion-Seite am 01.10. nach Archiv / EINS (archiviert) verschoben, `[ARCHIV]` im Titel; das Dokument lebt nur noch auf der Festplatte. |
| Checkliste, Fragebogen | Notion, Portal, Doku, Checklisten-PDF; D5 und F1 stillgelegt, F5 und F6 neu |
| Grundlagen-Seiten | Schmerz-Lösungs-Karte, Pain Register, ICP, Traumlösungen, Avatar (Master plus 20 Unterseiten), Wettbewerb, HWG; `context/02` bis `04` gespiegelt. Gemeldet, nicht Teil des Umbaus: SEO-Aussagen (Karte E4, Traumlösungen Cluster E und Zeile 19, Avatar-Unterseiten), unbelegte Zahlen (Karte, Values, Wettbewerb 6), Domain bridge.einsvisuals.de in Wettbewerb 8.2, kaputter Link in Resentments, Health nennt eine Person namentlich |
| Übrige Notion-Seiten aus der Suche | Read this before you quit EINS, Branding, Statistiken, EU-AI-Act-Referenz, Portal-Dashboard (Inhalt), Tool Stack |
| Website | Texte umgestellt, Build grün, NICHT deployt |
| Portal-Texte | FAQ, Medien, Leitfaden, Onboarding, Tour, Seed; Portal-Anleitung (md und PDF, 10 Seiten gepatcht) |
| Portal-Code | Garantie-Uhr unter `/admin/garantie`, Migrationen 0074 und 0075 (nur lokal angewendet), organische Kanäle getrennt in der Auswertung, 481 Tests grün |
| Verkaufsfolien | 17 Folien, neue Folie "Ihre Vorschau-Anzeigen" |
| Sotta-KB | 55 Fakten, Loader und Tests grün |
| Werkzeug-Recherche | `werkzeuge.md` (Empfehlung Remotion plus Synthesia) |

## Stand 01.10.2026: Umbau umgesetzt und geprüft

- **Verträge:** alle Word-Dateien in `Final` und `Verträge - Einfach` neu (HV v1.3, AGB v1.2, Anlage 1 v1.2, Garantie-Anhang v2.0, Zahlungsplan v1.2, AVV v1.3, TOMs v1.1, DSE v1.1, VVT v1.3, DPIA v1.1, KUG v1.1, NDA v1.2, Lösch-Konzept v1.1, neu: Einwilligung KI-Abbild und Stimme v1.0). Selbst geprüft: 30 docx ohne Treffer für altes Modell, U+2014/U+2013, Klinik (außer dem alten `Vertragskatalog_EINS_Visuals.docx`). VVT "Lead-Infrastruktur" → "Anfragen-Infrastruktur" (01.10.). Fortschritt: `D:\Desktop\EINS Dokumente\Verträge\Final\_UMBAU-2026-09-30-STAND.md`.
- **Notion-Verträge:** Hub, Vertragskatalog, Garantie-Anhang v2.0, Einwilligung; AGB- und Garantie-v1.0-Seiten als ersetzt markiert; Sphärenmodell statt pauschal 50/50.
- **Querverweise selbst geprüft:** Willkommensbrief-Zahlungsziele = HV v1.3 § 4 Abs. 2 und Zahlungsplan v1.2; Closing-Leitfaden (§ 3 Abs. 4, § 4 Abs. 2, § 5 Abs. 2 lit. g, § 9) und Deck ("§ 9 des Hauptvertrags") = HV v1.3.
- **Prüfung Dateien (verifier, Sonnet):** Website-Build, beide Typechecks, Portal-Tests, PDFs, Garantie-Uhr-Logik bestätigt. Gefundene Lücken behoben: cos-context (und die echten Quellen `Documents\ChatGPT` und `.codex\memory`, mit Sicherung), "Verzug nur nach Mitteilung" in 01-offer, north-star, AGENTS, Willkommensbrief (md, PDF, Notion), Leitfaden, FAQ, Website-Zeitleiste; 90 Tage in Einwand und zwei FAQ; Garantie-Uhr: Bestätigung trotz manuellem Ende gesperrt, Abfrage pro Praxis (484 Tests grün, Abfrage gegen lokale DB geprüft).
- **Prüfung Notion (verifier, Sonnet):** kein alter Modell-Text live. Behoben: Kleingedrucktes der Garantie auf Angebot, Grundlagen, Playbook, Prozess, Checkliste; Gedankenstriche/Anglizismen auf Statistiken, Portal-Referenz, Branding, Lessons. Vertragskatalog aufgeräumt: § 2.4 einzeln als überholt markiert, 4 Gedankenstriche, "Pilotmandate" raus, 51x Klinik → Praxis (1 wörtliches Zitat bleibt), 54x EUR → €; NDA-Archivseite verweist auf v1.2.
- **Kein Fehler:** "Karams Stunden pro Kunde" (Prozess § 7, Lessons) ist interne Kapazität laut PLAN Entscheidung 2. Lessons-Eintrag 11.05.2026 (90→360) gibt es nicht.

## Bereinigung 01.10.2026 (Karam: unbelegte Zahlen raus, Altlasten aufräumen)

- **Unbelegte Zahlen entfernt:** Sotta-KB ("6 bis 10 Anfragen pro 1.000 €", "20 bis 40 % Abschlussquote", "über 80 % Wunschbehandlungen"; 52 Fakten, 13/13 Tests grün); Notion Angebot und Spiegel 01 ("Die meisten Umsätze ..."); Der ganze Prozess (alle KPI-Zielwerte und "6 bis 10", jetzt "noch kein eigener Referenzwert"); Schmerz-Lösungs-Karte ("80 Prozent", "6 bis 12 Stunden", Mandats-Belege); Pain Register ("80 Prozent"); Wettbewerb ("50 bis 70 %"); Avatar Values ("8 plus Stunden").
- **SEO-Versprechen entfernt:** Karte E4 und M4, Traumlösungen Cluster E und Zeile 19, Pain Register E4, Avatar Doubts 11, Beliefs 6 und 9, Insecurities 5 und 7, Platforms 13 und Pitch. Die eigenen SEO-Gedanken des Avatars bleiben.
- **Sonstiges:** bridge.einsvisuals.de → bridge.eins.ag (Wettbewerb 8.2); kaputter Platzhalter-Link (Resentments); echter Name auf Health anonymisiert; Grammatikfehler aus Klinik-Ersetzung (Karte, Pain Register); "DACH-Privatklinik" (Traumlösungen); Spiegel 03/04 und cos-context samt MANIFEST nachgezogen.
- **Repo:** `otpauth` aus dem Portal entfernt (Typecheck grün); CLAUDE.md und AGENTS.md: Portal läuft auf Next.js 15.
- **Verträge (erledigt, Änderungsprotokoll "Bereinigung 01.10.2026"):** HV § 5, § 8, § 10 und NDA § 2 auf deutsche Begriffe (Datenschutz-Vorlage, Kontosperrungen, Leistungsdaten, Werbemittel, Zielgruppeneinstellungen, Anfragestrecken, Kennzahlen-Auswertungen, Preiskonditionen); Anlage 1 gleich; einfache NDA mit KRMedia (Marke EINS); Lösch-Konzept verweist auf AVV v1.3, TOMs v1.1, DPIA v1.1, HV v1.3, AGB v1.2, NDA v1.2. Bewusst behalten: Performance-Marketing, Social-Media, KI-Lead-Scoring (Dokumentname), Content-Fundament.

## Entscheidungen während der Umsetzung (in KANON.md eingetragen)

- Freigabe 2 Werktage, Klon-Aufnahme, Einwilligung und Zugänge 3 Werktage.
- Verzug verlängert die Frist nur, wenn EINS ihn per E-Mail mitgeteilt hat.
- Tag der Unterschrift zählt nicht (§ 187 Abs. 1 BGB), Anfrage am 90. Tag zählt noch.
- Meta-Sofortformulare sind kein EINS-Messweg.

## Offen für Karam

- Beispielrechnung im Angebot (früher mit 3.000 € Werbebudget und 3,5 pro 1.000 €) ist entfernt, es gibt keine neue.
- Höhe des Bargeld-Puffers für später eingehende erste Zahlungen.
- Ab welchem Tag ohne Anfrage EINS intern gegensteuert (z. B. kleines Werbebudget vorschlagen).
- Nutzung der Vorschau-Anzeigen, wenn die Praxis nicht unterschreibt (Empfehlung: bleiben bei EINS).
- Werkzeug-Wahl (Synthesia oder HeyGen), deutscher Qualitätstest mit eigenem Gesicht und eigener Stimme, etwa 118 $.
- MP3-Kapitel der Portal-Anleitung neu einsprechen: "Kapitel 1 + 2" und "Kapitel 3-7".
- Deploy der Website und der Portal-Migrationen 0074 und 0075 (erst nach Karams Freigabe).
- Offene Rechtspunkte aus den Verträgen, Karam entscheidet selbst (kein Anwalt): AI Act Art. 50, MBO-Ä § 27, Klon-Einwilligung.
- Skills `online-praxis-auftritt` und `teardown-video` bekommen den Schritt "Vorschau-Anzeigen" erst, wenn das Werkzeug gewählt ist.
- Weitere offene Rechtspunkte: Lösch-Konzept [OFFEN] F13 (Aufbewahrung der unterschriebenen Einwilligung), F14 (Klon-Videos bei EINS nach Widerruf), Rolle von EINS beim Klon (Auftragsverarbeiter oder eigener Verantwortlicher), Anbieter und Drittland.
- Altdateien ohne Nutzen: `Verträge - Einfach\Vertragskatalog_EINS_Visuals.docx`, `VertragPaidAdsTemplate.docx`, `VertragProduktionTemplate.docx` (Drehtag), `Sales-Einwände.pdf` (Notion-Export Januar): ins Archiv verschieben?
- Angebot nennt unter Erinnerungen noch "Vorsorge-, Prophylaxe- und Kontrolltermine" (Zahnarzt-Wortlaut) und ein "Auswertungs-Dashboard (Benly.ai)": prüfen.
- Lösch-Konzept widerspricht sich: Markdown "gilt als Teil der Anlage 3", Word-Fassung "selbst keine Anlage des AVV" (inhaltliche Frage, Karam entscheidet).

## Nachtrag 06.10.2026: Antwortzeit

Die 48 Werkstunden sind weiter keine Garantie-Bedingung, haben aber seit 06.10.2026 drei Folgen (KANON 6a, NACHTRAG-2026-10-06-ANTWORTZEIT.md). Nur die Schulung bleibt reine Empfehlung. Folgende Texte sind auf die neue Regel gebracht (Sicherungen in `_backup-2026-10-06` außerhalb von Git):

- **Portal-Texte:** `faq/content.ts` (Eintrag "Was muss ich dafür beitragen?", Eintrag "Wie schnell sollte ich auf eine neue Anfrage reagieren?", neuer Eintrag `frist-48-werkstunden` in der Kategorie Anfragen), `onboarding/checkliste/content.ts` (Schlusshinweis, jetzt fünf Punkte), `onboarding/fragebogen/content.ts` (Block D) und der Test `onboarding-content.test.ts`.
- **Docs im Repo:** `docs/asset-checkliste/checkliste-v1.md` und `BRIEF.md`, `docs/discovery-fragebogen/fragebogen-v1.md` und `BRIEF.md` (jeweils neue datierte Zeile, alte Historie unverändert).
- **PDFs:** `eins-asset-checkliste.pdf` neu erzeugt (`pnpm pdf:checkliste`), `WillkommenbeiEINS.pdf` neu gebaut (`D:\Desktop\Claude\eins-welcome-pdf`, `build.py --publish`). `eins-portal-anleitung.pdf` nicht neu erzeugt: Es gibt nur ein Patch-Skript für einzelne Passagen und keine reproduzierbare Quelle, und das PDF nennt die 48 Werkstunden nirgends.
- **Außerhalb von Git:** `EINS Dokumente\welcometext.md`, `Sales Deck\Closing-Leitfaden.md`, `Onboarding\portal_anleitung.md` (neuer Abschnitt 5.10 zur Frist und den Schildchen "Von der Praxis nicht beantwortet" und "Von der Praxis zu spät beantwortet"), `Claude\Projects\EINS\context\01-offer-wachstumssystem.md` und `06-garantie.md` (jetzt v2.1, Vertragsversionen v1.4, v1.3, v1.3, v2.1), `ChatGPT\projects\EINS\files\06-garantie.md` (aus context/06 synchronisiert), `.codex\memory\eins-business.md` (Antwortzeit und Freigabefrist 2 Werktage).
- **Sotta-KB:** `kb\karam\offer\wachstumssystem.md` und `kb\karam\script\script.md`.
- **Noch offen:** `PLAN.md` und die Notion-Seiten (nicht Teil dieses Auftrags), MP3-Kapitel und Video-Skript der Portal-Anleitung, ChatGPT-Kopie von `01-offer-wachstumssystem.md` (Stand 23.05.2026).
