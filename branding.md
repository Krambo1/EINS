# EINS Visuals — Branding

## Identity

- **Name:** EINS Visuals
- **Domain:** einsvisuals.com
- **Location:** Köln, Deutschland
- **Region served:** DACH (DE, AT, CH)
- **Contact:** team@einsvisuals.com · +49 1628456643

## Positioning

**One-liner:** Akquisitions-System für Ästhetik- und Schönheitskliniken im DACH-Raum.

**Elevator pitch:** Mehr Selbstzahler. Höhere Margen. Planbares Wachstum. Medienproduktion, bezahlte Anzeigen und ein durch Künstliche Intelligenz gestütztes System für Kliniken, als integriertes Produkt.

**Audience:** Inhaber und ärztliche Leitung von Ästhetik- und Schönheitskliniken, 40 bis 65 Jahre, nicht-technisch. Der Text muss in 10 Sekunden verstanden werden.

## Hero-Botschaft

> Mehr Patienten.
> Mehr Umsatz.
> Mehr Sicherheit.

**Subline:** Medienproduktion, bezahlte Anzeigen und ein durch Künstliche Intelligenz gestütztes System für Kliniken.

**Primärer CTA:** Strategie-Gespräch buchen (30 Minuten, Calendly)

## Das Produkt in 3 Schichten

1. **Videos & Fotos** — Produktion in der Klinik. Patienten bauen Vertrauen auf, bevor sie anrufen.
2. **Anzeigen auf Social Media** — Instagram, Facebook, Google, regional gezielt.
3. **KI sortiert Anfragen vor** — Preisjäger und Spam aussortiert, ernsthafte Patienten priorisiert. DSGVO-konform.

## Tonalität und Sprache

- **Formelle Ansprache:** durchgängig „Sie", „Ihr", „Ihnen" (immer großgeschrieben).
- **Deutsch vor Englisch.** Keine Anglizismen, wenn ein natürliches deutsches Wort existiert:
  - Call → Gespräch
  - Lead → Anfrage
  - Content / Asset → Medien / Video
  - Landingpage → Zielseite
  - Funnel → Strecke
  - Adspend → Werbebudget
  - Conversion → Abschluss / Abschlussquote
  - ROAS → Werbeertrag
  - Paid Ads → bezahlte Anzeigen
  - Sales-Playbook → Vertriebsleitfaden
  - Reporting → Auswertung
  - Testimonials → Patientenstimmen
  - Eigennamen bleiben (Instagram, Facebook, Google, Meta, Invisalign, All-on-4).
- **Keine Em-Dashes** (—). Komma, Punkt oder kurzer Bindestrich.
- **Kein „Premium"** als Etikett. Stattdessen „Erweitert".
- **Währung:** „€", nicht „EUR".
- **Direkt, konkret, kein Abstraktum.** Klare Überschrift, klare Erklärung, dann Details.

## Farben

| Token | Hex | Verwendung |
|---|---|---|
| Background Primary | `#ffffff` | Seitenhintergrund |
| Background Secondary | `#f5f5f7` | Karten |
| Background Tertiary | `#ebebef` | |
| Foreground Primary | `#10101a` | Haupttext |
| Foreground Secondary | `#4a4a52` | Nebensächlich |
| Foreground Tertiary | `#6a6a74` | Selten |
| Accent (Mint Teal) | `#58BAB5` | Marke |
| Accent Hover | `#64CEC9` | Gradient Top |
| Accent Glow | `rgba(88, 186, 181, 0.3)` | Schein/Halo |
| Border | `#e4e4e7` | |

**Akzent-Gradient:** `linear-gradient(180deg, #58BAB5 0%, #64CEC9 100%)`

**Theme:** Light. Dunkler Text auf weißem Hintergrund. Hoher Kontrast ist Pflicht.

## Typografie

- **Schriftfamilie:** Neue Haas Display (lokal, woff2), Weights 300 / 400 / 500 / 700.
- **Feature-Settings:** `ss01`, `cv11`. Letter-Spacing 0.012em, Word-Spacing 0.08em.
- **Headline-Stufen:**
  - `display-xl` — Hero, `clamp(2.75rem, 8.5vw, 7.5rem)`, line-height 0.95
  - `display-l` — Section H2, `clamp(2.375rem, 7.2vw, 6.5rem)`, line-height 1.02
  - `display-m` — kleinere Headlines, `clamp(2rem, 5vw, 4rem)`
- **Body:** `text-lg` bis `text-xl` für Fließtext; keine `text-base`-Defaults für Inhalte.
- **Keine Caps-Labels**, kein `uppercase tracking-wider`.

## Logo-Assets

- `eins-logo.png` — Wortmarke (Nav, Footer), 5311×2119
- `eins-mark.png` — Standalone „1"-Zeichen (Favicon, kleine Flächen)

## UI-Bausteine

- **ShinyButton** — primärer CTA, dunkler Hintergrund mit animierter Mint-Kontur.
- **Button** — shadcn-Style, Varianten: primary (Mint), outline, ghost.
- **Card-Pattern:** `card-glow rounded-2xl border border-border bg-bg-secondary/60 p-6 backdrop-blur-sm md:p-8`.
- **Reveal** — Framer Motion fade + y-Translate beim Scroll-Ins.
- **Eyebrow-Label:** Mono, 0.8125rem, Mint-Punkt davor.

## Section-Headline-Muster

```
<h2 class="display-l text-center">Hauptaussage.</h2>
<p class="mt-5 text-center font-display text-3xl font-semibold md:text-4xl">Stützender Satz.</p>
```

## Konversionsziel

Einziges Ziel der Seite: Klinikinhaber in ein 30-minütiges Strategie-Gespräch (Calendly) zu überführen. Jeder primäre CTA verweist auf `CALENDLY_URL`.

## Rechtliches

- Werbung der Klinik-Kunden unterliegt **Heilmittelwerbegesetz (HWG)** und ärztlichem Berufsrecht. EINS prüft alle Werbebotschaften als Teil des Basispakets.
- HWG betrifft die Kampagnen für Kliniken, **nicht** EINS' eigene Website (B2B-Agenturauftritt).
- DSGVO-konforme Formularlogik, max. 5 Felder, unter 2 Sekunden Ladezeit.
