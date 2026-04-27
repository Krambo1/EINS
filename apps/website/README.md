# EINS Visuals - Landing Page

Premium single-page landing site for EINS Visuals. Built with Next.js 14, TypeScript, Tailwind CSS, Framer Motion and Recharts.

---

## 1. Lokal starten (die ersten 5 Minuten)

### Node.js installieren

Laden Sie Node.js 20 LTS herunter: https://nodejs.org/de/download

Pruefen ob Node installiert ist:

```bash
node --version
npm --version
```

### Projekt installieren und starten

Im Projektordner `EINSWebsite`:

```bash
npm install
npm run dev
```

Dann im Browser oeffnen: http://localhost:3000

Zum Stoppen: `Ctrl + C` im Terminal.

---

## 2. Inhalte bearbeiten

Alle Texte, Preise und Statistiken liegen in `lib/`. Sie koennen sie direkt editieren, ohne Komponenten-Code anzufassen:

| Datei | Inhalt |
| --- | --- |
| `lib/constants.ts` | Calendly-URL, Kontakt-E-Mail, Anzahl aktive Kliniken |
| `lib/stats-data.ts` | Die 12 Statistiken im interaktiven Explorer |
| `lib/offer-data.ts` | Basispaket-Items, Standard/Premium-Tabelle, ROI-Szenarien |
| `lib/system-data.ts` | Die drei System-Ebenen |
| `lib/timeline-data.ts` | Onboarding-Timeline-Stationen |
| `lib/fit-data.ts` | Passungs-Checklisten (fuer/gegen Sie) |
| `lib/objections-data.ts` | FAQ / Einwandbehandlung |

**Calendly-Link aendern:** Oeffnen Sie `lib/constants.ts`, ersetzen Sie die URL in `CALENDLY_URL`, speichern. Fertig.

---

## 3. Auf Vercel deployen (kostenlos, 10 Minuten)

### Schritt A: Code auf GitHub pushen

1. Account bei https://github.com anlegen (falls noch nicht vorhanden).
2. Neues Repository erstellen: https://github.com/new - Name z. B. `einsvisuals-web`, privat lassen, **ohne** README/gitignore/license (haben wir schon).
3. Im Terminal, im Projektordner:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/IHR-USERNAME/einsvisuals-web.git
git push -u origin main
```

Ersetzen Sie `IHR-USERNAME` durch Ihren GitHub-Benutzernamen.

### Schritt B: Vercel verbinden

1. Auf https://vercel.com/signup mit dem GitHub-Account einloggen.
2. Nach dem Login: **"Add New... -> Project"** klicken.
3. Ihr GitHub-Repo `einsvisuals-web` auswaehlen, **"Import"**.
4. Alle Defaults so lassen (Framework: Next.js wird automatisch erkannt). **"Deploy"** klicken.
5. Nach ca. 90 Sekunden ist die Seite live unter `einsvisuals-web.vercel.app`.

### Schritt C: Eigene Domain verbinden (optional)

1. In Vercel das Projekt oeffnen -> **"Settings" -> "Domains"**.
2. `einsvisuals.com` (oder gewuenschte Domain) eintragen.
3. Vercel zeigt DNS-Eintraege an, die Sie bei Ihrem Domain-Anbieter (z. B. Strato, IONOS, Namecheap) setzen muessen.
4. Nach ein paar Minuten ist die Domain aktiv.

### Updates deployen

Jedes Mal wenn Sie Aenderungen machen und pushen, deployt Vercel automatisch:

```bash
git add .
git commit -m "Update Texte"
git push
```

---

## 4. Projektstruktur

```
app/                Next.js App Router (Seiten + Layout + globales CSS)
components/
  nav.tsx           Sticky Navigation
  footer.tsx
  scroll-progress.tsx
  sections/         Die 11 Landing-Page-Sektionen
  ui/               Wiederverwendbare Bausteine (Button, Accordion, Tabs, Charts)
lib/                Alle Inhalte als typisierte Daten
public/             Logos und statische Assets
```

---

## 5. Technologie-Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS mit EINS-Design-Tokens als CSS-Variablen
- Framer Motion fuer Scroll-Animationen
- Recharts fuer interaktive Diagramme
- Radix UI Primitives (Accordion, Tabs) + shadcn-Pattern
- Lucide React Icons
- Self-hosted Fonts via `next/font/google` (Space Grotesk, Inter, JetBrains Mono)

---

## 6. Qualitaets-Checks

```bash
npm run typecheck   # TypeScript-Fehler pruefen
npm run build       # Production-Build lokal testen
```

---

## Fragen?

team@einsvisuals.com
