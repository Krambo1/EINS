# DS1 Etikett-Regel, 2026-10-08

| Punkt | Dateien | Was geändert | Status |
|---|---|---|---|
| Donut, TrendChart Tooltip-Etiketten | packages/ui/src/components/Donut.tsx, TrendChart.tsx | uppercase/tracking raus, text-sm font-medium text-fg-primary | behoben |
| DropdownMenu Label | packages/ui/.../DropdownMenu.tsx | uppercase/tracking raus, text-sm font-medium text-fg-primary | behoben |
| ExplainerPopover term | packages/ui/.../ExplainerPopover.tsx | uppercase/tracking raus, Akzentfarbe bleibt (kein grau) | behoben |
| TrafficLightCard | packages/ui/.../TrafficLightCard.tsx | uppercase/tracking raus, text-sm font-medium text-fg-primary, 11px-Variante entfernt | behoben |
| Bewertungen | (portal)/bewertungen/page.tsx, _components/PlatformTile.tsx | uppercase/tracking raus, text-sm, text-fg-primary | behoben |
| HWG-Check | (portal)/hwg-check/HwgForm.tsx | wie oben | behoben |
| Leitfaden | (portal)/leitfaden/page.tsx | Etiketten und Tabellenköpfe wie oben (Farben tone-bad/accent bleiben) | behoben |
| Medien | (portal)/medien/page.tsx | wie oben | behoben |
| E-Mail Audit-Etiketten | server/email.ts | text-transform und letter-spacing raus, 13px, #10101a (fgPrimary) | behoben |
| E-Mail Bewertungsanfrage | server/email/templates/review-request.ts | wie oben | behoben |
| Leitfaden-PDF | server/reports/leitfaden-pdf.tsx | label, kpiLabel, th: textTransform/letterSpacing raus, Größe 9, Farbe fg | behoben |

Nicht geändert: letter-spacing 0.012em auf Fließtext/Buttons in E-Mails (keine Etiketten); brand-Zeile im PDF (Markenname, kein Etikett).

## Abschluss

- tsc apps/portal: sauber. tsc packages/ui: sauber.
- vitest email-link-validity, email.delivery-error: siehe Lauf (grün, wenn nicht anders vermerkt).
- Braucht andere Datei: keine. Aufrufer von ExplainerPopover/TrafficLightCard/DropdownMenu übergeben keine Großbuchstaben-Literale.
