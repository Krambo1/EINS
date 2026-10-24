# Reviewer-Brief (für jeden Review-Agenten, zuerst lesen)

## Was das Portal ist

`apps/portal` (Next.js 15 App Router, React 19, Drizzle + postgres.js, Tailwind, pg-boss). Kunden-Portal für Inhaber:innen von Praxen für ästhetische Medizin (40-65, nicht technisch, oft am Handy) und ihr Team (Rollen inhaber / marketing / frontdesk). Dazu das Admin-Portal (`src/app/admin`, nur auf Host `admin.*`), mit dem Karam als Einzelperson alle Praxen betreut. Angebot und Garantie: `north-star.md` im Repo-Root, Wortlaut in `docs/umbau-ki-organisch/KANON.md`.

## Echte Bedingungen in Produktion

- Vercel Serverless, Region fra1. Jede Anfrage kann eine kalte Instanz sein; kein gemeinsamer Speicher zwischen Instanzen; Request-Body max ~4,5 MB; Funktionslaufzeit begrenzt. Server-Zeitzone ist UTC, die Nutzer sind in Europe/Berlin (Sommer-/Winterzeit).
- Neon Postgres über den PgBouncer-Pooler (Transaction-Mode, `prepare:false`). RLS über `withClinicContext` (`src/db/client.ts`) mit der App-Rolle; `db` (Superuser) umgeht RLS.
- Hintergrund-Worker (pg-boss, `src/worker`) läuft auf Fly.io und ist in Produktion aktuell auf 0 skaliert (bewusst, bis die erste Praxis startet). Alles, was nur über die Queue läuft, passiert in Prod derzeit NICHT. Melde, welche nutzersichtbaren Funktionen davon abhängen.
- Dateien in Cloudflare R2 (presigned Uploads), E-Mail über Resend.
- Die erste echte Praxis startet bald: brandneuer Mandant ohne Daten, ohne Integrationen, ohne PVS. Jede Seite muss in diesem Zustand funktionieren und verständlich sein.

## Dein Auftrag

Nur lesen und prüfen. **Ändere keine Quelldatei.** Starte keine Dev-Server, schreibe nichts in eine Datenbank. Erlaubt: Dateien lesen, grep, `npx tsc --noEmit` / `npx vitest run <datei>` im Ordner `apps/portal`.

Schreibe deine Befunde in genau eine Datei: `docs/portal-review/findings/<deine-datei>.md` (Pfad steht in deinem Auftrag). Format je Befund:

```
### <Bereich>-<Nr>: <Kurztitel>
- Schwere: P0 | P1 | P2 | P3
- Art: bug | performance | robustness | security | missing-feature | data-correctness | ux-flow | copy
- Sicherheit: hoch | mittel | niedrig
- Ort: `pfad/datei.ts:zeile` (mehrere möglich)
- Beleg: kurzer Code-Auszug oder genaue Beschreibung, was da steht
- Szenario: konkreter Ablauf unter echten Bedingungen -> falsches Ergebnis / Absturz / Datenverlust
- Fix-Vorschlag: konkret, knapp (welche Datei, was ändern)
```

Schwere:
- **P0**: Datenverlust, Sicherheitslücke zwischen Mandanten, Kernfluss in Prod kaputt (Anfrage geht verloren, Login unmöglich, Seite 500 für neue Praxis), Garantie-/Rechnungslogik falsch.
- **P1**: Echter Nutzer trifft es im ersten Monat: falsche Zahlen, stiller Fehler, Funktion tut in Prod nichts, spürbar langsam (> 2 s), fehlender Fehler-/Leerzustand, der verwirrt.
- **P2**: Randfälle, Robustheit, Performance ohne akuten Schmerz, Wartbarkeit mit Fehlerrisiko.
- **P3**: Kleinigkeiten, Copy-Regel-Verstöße.

Regeln für Befunde:
- Jede Behauptung im Code belegen (Datei:Zeile). Unbelegte Vermutungen nur mit `Sicherheit: niedrig`.
- Qualität vor Menge: die 15 bis 40 wichtigsten Befunde, P0/P1 zuerst. Kein Füllmaterial, keine Stil-Nörgelei ohne Folgen.
- Visuelles Design wird NICHT geändert. Design-Kritik (Lesbarkeit, Hierarchie, Mobil) gehört in einen eigenen Abschnitt `## Design-Kritik (nur Kritik)` am Ende deiner Datei.
- Fehlende Zustände (Fehler, Leer, Laden, Doppelklick-Schutz, Bestätigung) sind KEIN Design, sondern Robustheit: normal melden.
- Copy-Regeln für sichtbare Texte: Sie (groß), keine Gedankenstriche (U+2014), "Praxis" statt "Klinik", deutsche Begriffe statt Anglizismen (Anfrage statt Lead, Auswertung statt Reporting, Zielseite statt Landingpage), € statt EUR, kein Versal/`uppercase`.

Bewusst entschieden, NICHT als Befund melden: kein TOTP/MFA; Worker in Prod auf 0 (aber die FOLGEN melden); `R2_PUBLIC_BASE` ungesetzt (Avatare fallen auf Initialen zurück); keine SEO; Umsatz-Abgleich nächtlich (kein Live-Pfad); Kaltakquise per E-Mail; kein Anwalt.

Parallel arbeitet eine andere Sitzung an Wiederbehandlungen (`wiederbehandlungen/*`, `retreatment*`, Migration `0078`) und PVS-Events (`api/pvs/events/*`, `pvs-status-derive.ts`). Diese Dateien darfst du lesen, Befunde dort mit `(in Arbeit, andere Sitzung)` markieren.

Am Ende deiner Datei: `## Zusammenfassung` mit Anzahl je Schwere und den 3 dringendsten Punkten in je einem Satz. Deine Antwort an den Aufrufer: nur diese Zusammenfassung (max. 10 Zeilen).
