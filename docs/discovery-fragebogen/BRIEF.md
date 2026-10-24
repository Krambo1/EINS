# BRIEF: Discovery-Fragebogen (Kunden-Onboarding)

Single source of truth für dieses Projekt. Bei Konflikt: erst fragen, dann ändern.

## Goal

Der **Discovery-Fragebogen** ist das Dokument/Formular, das die Asset-Liefer-Checkliste bereits referenziert ("Ziele, bisheriges Marketing, Erfahrungen"), aber das noch nicht existiert. Er erfüllt **drei Jobs**:

1. **Fulfilment**: Nach Discovery kann EINS KI-Klon, erste Beiträge, Zielseite und Vertriebs-Setup ohne Rückfragen bauen (füttert den internen Strategie-Brief aus "Der Ablauf" Phase 0).
2. **Avatar-Forschung**: Jede ausgefüllte Discovery reichert das Avatar/ICP-Wissen systematisch an (echte Inhaber-Antworten statt Sekundärquellen).
3. **Input für Beiträge und Anzeigen**: Zielgruppe, Behandlungs-Fokus, Einzugsgebiet, Saisonalität, Wettbewerb und Zahlen-Baseline stehen fest.

**Mechanik gegen Überlänge**: Pflichtfragen (ohne die das Fulfilment nicht starten kann) vs. optionale Fragen (Avatar-Tiefe, nice-to-have) sind hart getrennt. Optional bleibt sichtbar überspringbar.

## Auslieferung (zwei Teile)

- **Teil 1 · Vorab-Formular im EINS-Portal** (apps/portal, neue Kunden-Seite): Fakten- und Spannen-Fragen, die der Inhaber/das Team asynchron beantwortet. Pflicht/optional-Kennzeichnung, Antworten strukturiert in der DB.
- **Teil 2 · Gesprächsleitfaden** (internes Dokument): Tiefenfragen fürs 90-Min-Onboarding-Gespräch, die im Gespräch reicher beantwortet werden (Motivation, Frust-Historie, Positionierung). Karam stellt die Fragen, füllt selbst aus.

## Success criteria

- **Kein Rückfragen-Loop**: Nach ausgefülltem Fragebogen + Gespräch kann der Start der ersten Beiträge (Woche 1 bis 2) ohne weitere Inhaber-Termine erfolgen.
- **Zahlen-Baseline erfasst**: genug Zahlen (als Spannen), um die Auswertung (Anfragen, Abschlussquote, Werbeertrag) später gegen den Ausgangswert zu messen.
- **Avatar-Delta**: pro Discovery mindestens eine Handvoll Antworten, die direkt in Avatar/Pain-Register-Updates fließen können.
- **Zeitbudget gehalten**: Gesamtkosten für den Inhaber ~45-60 Min (Vorab-Formular + Gesprächsanteil zusammen).

## Constraints

- **Abgrenzung**: KEINE Überschneidung mit der Asset-Liefer-Checkliste (Zugänge, Logo, Fotos, Preislisten-Lieferung, AVV = Checkliste; Ziele, Markt, Erfahrungen, Zahlen = Fragebogen).
- **Copy-Regeln** (CLAUDE.md): formales Sie, kein Em-Dash, "Praxis" nie "Klinik", Anti-Anglizismus, €, kein All-Caps, Klartext zuerst.
- **Avatar-Sprache**: keine Marketing-Akronyme (CPL, ROAS, Funnel) in Richtung Inhaber; Patientenströme-/Behandlungs-Sprache. Zahlenfragen als Spannen/Schätzfragen mit kurzem "Warum wir fragen"-Satz.
- **Konsistenz**: Selbstauskunft-Antwortoptionen und KPI-Begriffe müssen 1:1 zum Lead-Tracking-Playbook passen (8 Optionen, UTM-Konvention, qualifizierte Anfrage-Definition).
- **Portal-Konventionen**: bestehende UI-Primitives (@eins/ui), keine `bg-*/NN`-Opacity-Tokens, RLS-Muster der bestehenden Tabellen.

## Non-goals

- Keine Neuauflage des Onboarding-Prozesses ("Der Ablauf" bleibt wie er ist; der Fragebogen füllt nur dessen Phase 0 sauber aus).
- Keine Vertrags-/AVV-Inhalte, keine rechtliche Beratung.
- Kein patientengerichtetes Formular (das ist Lead-Intake in clinic-landing).
- Keine Zahnärzte-Variante.
- Kein Admin-Auswertungs-Dashboard über Discovery-Antworten (später denkbar, nicht jetzt).

## Key open assumptions

- Die Vault-Notiz `10 EINS/Kunden/Discovery-Fragebogen (Kunden-Onboarding).md` (Vault `D:\Desktop\Claude\Obsidian\Karam`) bleibt Master für den **Inhalt**; das Portal-Formular ist die ausfüllbare Instanz von Teil 1.
- Der Gesprächsleitfaden (Teil 2) lebt nur in der Vault-Notiz, nicht im Portal.
- Antworten aus dem Portal-Formular sind clinic-scoped und für Admin (Karam) einsehbar; kein Export nötig in v1.
- Pflichtteil Vorab-Formular: realistisch ~15-20 Fragen, Gesprächsteil ~15-20; Gesamtzeit ~45-60 Min.

## Decision log

- 2026-06-12: Drei gleichwertige Jobs (Fulfilment, Avatar, Ads), Überlänge wird über Pflicht/Optional-Split gelöst, nicht über Streichung. (Karam, Interview)
- 2026-06-12: Format = Vorab-Formular + Gespräch; Vorab-Teil als Portal-Formular in apps/portal. (Karam, Interview)
- 2026-06-12: Zeitbudget ~45-60 Min gesamt. (Karam, Interview)
- 2026-06-12: Sensible Zahlen ja, aber als Spannen/Schätzfragen mit Begründungssatz. (Karam, Interview)
- 2026-06-12: Buckets genehmigt: 1 Inhalt v1 → 2 Notion → 3 Portal-Formular → 4 Admin-Sicht. Content-first. (Karam)
- 2026-06-12: Bucket 1 geliefert: fragebogen-v1.md, 40 Fragen (23 Portal-Vorab / 17 Gespräch, 29 Pflicht). Wartet auf Review.
- 2026-06-12: Review Karam: Google-Bewertungs-Frage (alt C4) gestrichen, F1-Budget-Spannen ab 3.000 € (Angebots-Minimum). Neu: 39 Fragen (22/17), 29 Pflicht.
- 2026-06-12: Bucket 2 geliefert: Notion-Seite "Discovery-Fragebogen (Kunden-Onboarding)" (37de7fc8-8734-81ee-b2d1-c86bf7cbefbe) in Unternehmens-Basis; Cross-Links in Asset-Liefer-Checkliste + "Der Ablauf" Phase 0 gesetzt, Seite per Fetch verifiziert.
- 2026-06-12: Zählfehler korrigiert (Doc + Notion): real Teil 1 = 26 Fragen/20 Pflicht, Teil 2 = 21/17, gesamt 47/37. Fragenbestand unverändert.
- 2026-06-12: Bucket 3 geliefert: Migration 0061 (discovery_fragebogen, RLS, 1 Zeile/Praxis, jsonb answers), Fragen in content.ts, Seite /onboarding/fragebogen (Inhaber-only via onboarding.complete), Entwurf+Einreichen-Server-Action mit Pflicht-Check, read-only nach Einreichen, Schritt 1 in "Erste Schritte". Preview-verifiziert (Login→ausfüllen→Entwurf→Reload→Einreichen→Recap), typecheck grün.
- 2026-06-12: F1-Budget geändert (Karam): Preset-Pills bleiben ab 3.000 € (empfohlener Floor), zusätzlich Freitext-Feld „eigener Betrag". Harter Floor 1.500 €/Monat (= ICP-Adspend-Untergrenze aus 02-icp.md), darunter blockierende Fehlermeldung server- und clientseitig; 1.500-2.999 € weicher, nicht-blockierender Hinweis. Live-Note + Server-Enforcement preview-verifiziert. Konsistent mit ICP (1.500-3.000 €), kein Konflikt mit Angebots-Empfehlung 3.000 €.
- 2026-06-12: Bucket 4 geliefert: Admin-Tab "Fragebogen" auf /admin/clinics/[id] (read-only Recap aller 26 Fragen mit Frage-IDs, Status-Badge Entwurf/Eingereicht, Beantwortet-Zähler, offene Pflichtfragen, Einreicher+Datum, EmptyState wenn nicht begonnen). Kein Edit/Reopen in v1. Liste /admin/clinics OHNE Spalte (Leaderboard-Query zu invasiv für den Nutzen, bewusst geskippt). Preview-verifiziert als Admin, typecheck grün. Alle 4 Buckets damit abgeschlossen.
- 2026-09-30: Umbau auf KI-Klon und "Keine Anfrage, keine Rechnung" (Karam, Kanon). Block J (Teil 2) wird "Ihr KI-Klon". F1 (Werbebudget, ID bleibt): freiwillig, ohne Mindestbetrag, neue Auswahlwerte, alte gespeicherte Werte bleiben lesbar. Block D: 48 Werkstunden nur Empfehlung. Zahlen-Baseline (C2) bleibt. Portal Teil 1: 26 Fragen, 19 Pflicht. Alle IDs unverändert, keine neue Frage im Portal. Nicht geprüft: gespeicherte Antworten in der Prod-DB (kein Zugriff aus dieser Sitzung); der Code verträgt unbekannte IDs.
- 2026-09-30 (Nachtrag): Portal-Texte des Fragebogens auf den Kanon gebracht. Nach dem Einreichen steht "Wir bauen darauf Ihren KI-Klon, Ihre ersten Beiträge und Ihre Zielseite auf", die Kampagnen-Erwähnungen sind raus. F1: Mindest- und Richtbetrag samt Hinweistexten entfernt (customMinEur und recommendedMinEur gibt es nicht mehr, nur nicht-numerische Eingaben werden abgewiesen). Block B "Warum wir fragen": "Strategie" statt "Kampagne". Mapping-Zeile "Kampagnen-Setup" heißt jetzt "Erste Beiträge und spätere Anzeigen". Notion, Portal und Dokument tragen denselben Wortlaut.
- 2026-10-06: Antwortzeit (KANON 6a): Block D "Warum wir fragen" nennt die 48 Werkstunden mit dem Kundenwortlaut aus dem Nachtrag 06.10.2026 (keine Bedingung der Garantie, drei Folgen). Die Zeile aus dem Eintrag vom 30.09.2026 ("nur Empfehlung") gilt nicht mehr. Fragen und IDs unverändert.
