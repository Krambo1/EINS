# EINS Visuals — Sales Deck

`EINS-Strategievorschlag-TEMPLATE.pptx` ist ein 15-Folien-Verkaufsdeck für Strategiegespräche mit Klinik-Inhabern im DACH-Raum. Der Founder geht das Deck live mit dem Interessenten durch.

## Vor jedem Pitch ersetzen (Pflicht)

Alle clinic-spezifischen Felder sind als `[BRACKETED]` markiert. Mit Strg+H in PowerPoint Suchen und Ersetzen, oder per Hand pro Folie:

| Platzhalter | Bedeutung | Folie |
|---|---|---|
| `[KLINIK_NAME]` | Voller Klinikname | 1, 4, 12 |
| `[STADT]` | Standort der Klinik | 1, 4, 11, 13 |
| `[DATUM]` | Datum des Strategie-Gesprächs | 1 |
| `[KLINIK_LOGO]` | Logo der Klinik (Bild einfügen statt Platzhalter-Text) | 1 |
| `[BEHANDLUNGS-SCHWERPUNKT]`, `[BEHANDLUNG_X]`, `[BEHANDLUNG_Y]` | Spezialisierungen aus Recherche | 4, 5 |
| `[GRÜNDUNGSJAHR]`, `[ÄRZTLICHER_LEITER]`, `[USP_1]` | Stammdaten der Klinik | 4 |
| `[INSIGHT_AUS_DISCOVERY_CALL]` | Eine konkrete Beobachtung aus dem Discovery-Call, die zeigt, dass zugehört wurde | 4 |
| `[N]` | Zielanzahl zusätzlicher Patienten / Monat | 5 |
| `[N_PATIENTEN]`, `[Ø_BEHANDLUNGSWERT_EUR]` | Zahlen für die Value-Equation auf Folie 10 | 10 |
| `[FOLLOWUP_DATUM]` | Konkretes Datum für Option B | 15 |
| `[DATUM_GÜLTIG_BIS]` | Wie lange beide Optionen verbindlich sind | 15 |

Die Standard-Zahlen für Folie 10 (Value Equation) basieren auf dem konservativen Szenario aus `apps/website/lib/offer-data.ts`. Wenn die Klinik einen höheren Behandlungswert hat (z. B. Implantologie, Facelift), die Zahlen vor dem Pitch im Discovery-Call-Brief neu rechnen.

## Folie 8 (Fallstudie) — Pflicht-Hinweis

Die Folie ist als Platzhalter markiert (sichtbar auf der Folie + im Speaker-Note). EINS hat zum Stand 2026-04-27 keine geschlossenen Klinik-Cases. Drei Optionen vor dem Pitch:

1. **Folie überspringen.** In PowerPoint die Folie ausblenden (Rechtsklick → Folie ausblenden).
2. **Mit echtem Q3-2026-Mandant ersetzen.** Sobald der erste Case dokumentiert ist, Zahlen und Zitat eintragen, Internal-Hinweis löschen.
3. **Mit zitierter Branchen-Case-Study ersetzen.** Z. B. „1.252 % ROAS bei Implantat-Kampagne, Australien 2018" (Notion `Statistiken` #3) mit klarer Quellenangabe.

Niemals als eigene EINS-Klinik claimen. Speaker-Note auf Folie 8 erinnert daran.

## Folie 11 (Garantie) — gilt nur für ersten zwei Mandate

Die 6-fache Garantie ist in dieser Stärke nur für die ersten zwei Mandate Q3 2026 verfügbar. Ab Mandant #3 gilt die normale 90-Tage-Garantie aus dem `[Intern] Angebot`-Notion-Doc.

Wichtig: Niemals als „Pilot" framen. Das Wort taucht im Deck nicht auf (verifiziert per Grep).

## Folie 12 (Pricing) — Decoy-Struktur

- Paket A (Standard, 2.600 €/Monat) ist der Anker.
- **Paket B (Empfohlen, 3.900 €/Monat) ist das Ziel.** Der Empfohlen-Pin und Mint-Akzent leiten dorthin.
- Paket C (Premium+, 5.900 €/Monat, 6 Monate Mindestlaufzeit) ist der Decoy. Macht B vernünftig.

Nicht Paket A drücken, nicht Paket C verkaufen.

## Re-Build

Wenn Copy oder Zahlen sich ändern, einfach das Build-Script erneut laufen lassen. Re-runs sind deterministisch.

```powershell
cd D:\Desktop\EINSWebsite\sales-deck
python build_deck.py
```

Abhängigkeiten: `python-pptx`, `Pillow`. Installation:

```powershell
pip install python-pptx Pillow
```

## Quellen für Copy und Zahlen

| Inhalt | Quelle |
|---|---|
| 6-fache Garantie + Counter-asks | `apps/website/components/sections/guarantee.tsx:7-44` |
| Hero-Stimme, Scarcity-Badge | `apps/website/components/sections/hero.tsx` |
| Basispaket (5 Items) | `apps/website/lib/offer-data.ts:8-66` |
| Standard vs. Premium (Retainer) | `apps/website/lib/offer-data.ts:74-88` |
| ROI-Szenarien (für Folie 10) | `apps/website/lib/offer-data.ts:99-105` |
| FAQ / Einwand-Vorgriff | `apps/website/lib/objections-data.ts` |
| Onboarding-Timeline | `apps/website/lib/timeline-data.ts` |
| 72%-Zahl (Folie 6) | rater8 Healthcare Trends 2025 (Notion `Statistiken` #8) |
| Brand-Tokens (Farben, Schriften) | Notion `Branding` |
| Positionierung, ICP, Pricing | Notion `EINS VISUALS Grundlagen`, `[Intern] Angebot (Schönheitskliniken)` |
| Voice-Regeln (Sie-Form, keine Em-Dashes, keine „Pilot"-Sprache) | Notion `Branding` + Handoff `2026-04-27-0227` |

## Animations-Hinweise (in PowerPoint nachjustieren)

Das Build-Script setzt nur die Slide-Transitions (Fade durch Schwarz, 0,4 s). Per-Element Click-Animationen können in PowerPoint manuell gesetzt werden:

- Folie 5 (Ziele): pro Goal `Erscheinen` auf `Mit Klick`, 0,3 s
- Folie 6 (Lücken): pro Lücke `Erscheinen` auf `Mit Klick`, 0,3 s
- Folie 9 (Leistungen): jeden Pfeil sequentiell `Erscheinen`, 0,4 s, vorheriger Bullet-Trigger
- Folie 10 (Value Equation): jede Zeile `Wischen` von links, 0,3 s, mit Klick
- Folie 12 (Preise): Paket B `Vergrößern/Verkleinern` 95→100 %, 0,4 s, automatisch beim Folienstart

Diese Animationen sind im Plan `C:\Users\karam\.claude\plans\role-you-are-building-vast-unicorn.md` (Animations-Tabelle) dokumentiert.

## Checklist vor jedem Pitch

- [ ] Klinik-Logo auf Folie 1 eingesetzt
- [ ] Alle `[BRACKETED]` Platzhalter ersetzt
- [ ] Folie 5 Ziele auf den Discovery-Call abgestimmt
- [ ] Folie 8 entweder ausgeblendet, mit echtem Case ersetzt oder mit Branchen-Case + Quelle ergänzt
- [ ] Folie 10 Zahlen für die jeweilige Klinik gerechnet (nicht Default lassen)
- [ ] Folie 15 Follow-up-Datum gesetzt
- [ ] Animationen geprüft im Präsentationsmodus (Slides 5, 6, 9, 10, 12)
