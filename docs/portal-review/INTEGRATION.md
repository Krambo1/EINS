# Integrationsrunde (nach WS1-WS9)

Gesammelt aus den Abschnitten "Braucht andere Datei" aller Logs. Zwei Fixer auf getrennten Dateien. Jeder Punkt: erst prüfen, ob schon erledigt (Logs anderer WS lesen), dann gezielt ändern. Log: `fixes/INT-A.md` bzw. `fixes/INT-B.md`.

## INT-A: Server, E-Mail, Cron, Konfiguration

| ID | Datei | Was |
|---|---|---|
| A1 | `src/server/ops-alerts.ts` | `notifyOps` sendet über `enqueueEmail` und kommt bei Worker 0 nie an. Auf `sendEmailOnce` (`server/email-once.ts`) umstellen, Schlüssel `ops/<kind>/<Zeitfenster>`, bestehende 6-h-Drosselung beibehalten. |
| A2 | `src/lib/env.ts` | `CRON_SECRET`, `GOOGLE_ADS_API_VERSION`, `OPS_ALERT_EMAIL` ins Schema (optional, Prod-Warnung wenn `CRON_SECRET` fehlt). Kein Boot-Abbruch. |
| A3 | `src/server/email.ts` | Einladungsmail (Intent `invite`) sagt dreimal "15 Minuten gültig", der Link gilt 7 Tage (`INVITE_LINK_TTL_SECONDS`). Für `invite` den echten Wert ausgeben. |
| A4 | `apps/portal/next.config.ts` | `outputFileTracingIncludes: { "/api/health": ["./src/db/migrations/*.sql"] }`; `Referrer-Policy: no-referrer` für `/login/link` und `/admin/login/link` (spezifischer Eintrag vor dem globalen). |
| A5 | `src/app/api/cron/**` | (a) Nachholer: Anfragen mit `new_request_notified_at IS NULL` und `created_at` jünger 24 h, je Zeile `notifyNewRequest(id)` aus `@/server/request-notify`. (b) Archivierte Praxen (`clinics.archived_at`) in allen Cron-Schritten überspringen. |
| A6 | `apps/clinic-landing/app/r/[token]/page.tsx` (+ Aktion) | Stern erst nach bewusster Aktion (Klick/POST) buchen, nicht beim Seitenaufruf; Link-Scanner dürfen keine Bewertung erzeugen (E-31 Rest). |
| A7 | `src/auth/magic-link.ts` | Logzeilen ohne Klartext-E-Mail und ohne rohe `clinic=<uuid>` (A-12 Rest). |
| A8 | Root-`package.json` | Weiterleitungen `test:e2e` und `db:studio` entfernen (Ziel-Skripte gibt es nicht mehr). |
| A9 | `src/app/api/leads/intake/route.ts` | Nur prüfen: nutzt `trustedIpFromHeaders` (I-9). |
| A10 | `export const maxDuration = 30` | In API-Routen mit Upload, CSV-Import, PDF/Export (`api/uploads/**`, `api/files/**`, `api/requests/export`, `api/admin/clinics/[id]/dsgvo/export`, CSV-Upload-Route). Nicht in Dateien der anderen Sitzung. |

## INT-B: Oberfläche und Abfragen

| ID | Datei | Was |
|---|---|---|
| B1 | `src/lib/dashboard-range.ts` | Nur prüfen: `dashboardRangeWindow` liefert Berliner Tagesgrenzen (WS2-Hinweis, WS5 A-02). |
| B2 | `src/server/queries/requests.ts` | `leadsDailyInRange`, `openQueueDailyInRangeWithComparison`, `leadsInRangeWithComparison`: übrige Aufrufer auf Berliner Tage. Ungenutzte entfernen. |
| B3 | `anfragen/[id]/actions.ts` | `revalidateLead` ruft `invalidateClinicKpiCache(clinicId)` auf. |
| B4 | `anfragen/[id]/page.tsx` | `after()`-Audit "view" bekommt `impersonatedByAdminId: session.impersonatedByAdminId` (B-24). |
| B5 | `anfragen/_components/AnfragenFilters.tsx`, `lib/constants.ts` | Statusfilter aus `ALL_REQUEST_STATUSES`/`ALL_REQUEST_STATUS_LABELS` ("Nicht erschienen", "Behandelt"); Sortierlabel `ltv` = "Gesamtumsatz". |
| B6 | `(portal)/_components/UserMenu.tsx` | "Abmelden" als `<form method="post">` mit gleich aussehendem Knopf. |
| B7 | `(portal)/_components/ImpersonationBanner.tsx` | Restzeit der 30-Minuten-Ansicht aus `expiresAt`, gleicher Stil. |
| B8 | `admin/audit/**`, Praxis-Verlauf im Admin | Spalte `audit_log.impersonated_by_admin_id` als "durch Admin in Kundenansicht" anzeigen. |
| B9 | `dateien/actions.ts`, `medien/actions.ts`, `bewertungen/feedback/actions.ts`, `einstellungen/integrationen/actions.ts`, `syncReviewsNowAction` | Wo noch ohne try/catch: `{ ok: false, error }` mit deutscher Meldung zurückgeben, Eingaben bleiben erhalten (F-01, F-25). |
| B10 | neu `loading.tsx` | `(portal)/onboarding`, `(portal)/dateien`, `(portal)/hwg-check` im Stil der vorhandenen Ladezustände. |
| B11 | `admin/clinics/[id]/_components/ChecklisteTab.tsx` | Links über `normalizeChecklistLink(link) ?? link`, nur `http(s)` als `<a href>`. |
| B12 | Seitenleiste (`queries/navBadges*`, `_components`) | Zähler "fällige Wiedervorlagen" (C-20 Teil 2) über `dueFollowups`, in denselben einen Badge-Aufruf falten (keine zusätzliche Transaktion). |
| B13 | Anfrage-Detail/Liste | KI-Begründung (`aiReasoning`) zeigt englische Rohwerte ("asap", "info-only", "= 74 (hot)"): beim Rendern auf Deutsch abbilden (C-32). |
| B14 | `anfragen/[id]/_followups.tsx` | Nur prüfen: Berliner Zeit. |

## Nicht für uns (andere Sitzung oder anderes Projekt)

- `src/worker/index.ts`: `uncaughtException`/`unhandledRejection`-Handler, Hard-Timeout im Shutdown (E-03/E-22).
- `src/worker/schedules.ts`: kpi-rebuild-Dispatcher auf Berliner "gestern".
- `src/server/jobs.ts`: `enqueueEmail`-Payload um `idempotencyKey?: string`.
- `retreatment-reminder.ts`: Cron-Pfad ohne Worker (dann in `/api/cron/morning` aufnehmen).
- `wiederbehandlungen/**`: `loading.tsx`, Aktionsname an `flashMessageFromError`.
- PVS-Routen: `trustedIpFromHeaders` statt linkem XFF-Eintrag.
- `apps/website` Videoseite: 404 der Video-API sauber anzeigen, nicht cachen; `?intern=1` durch serverseitig signiertes Flag ersetzen (G-18/G-22).
- R2-Waisen-Aufräumen: braucht ListObjectsV2 im Storage-Adapter, eigener kleiner Auftrag.
