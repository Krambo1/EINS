import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { AlertCandidate, AlertSeverity } from "./types";

/**
 * Anomaly rules. Each rule is a pure async function that reads from the
 * superuser db connection (workers run outside an RLS user context) and
 * returns zero or more AlertCandidate objects for the given clinic.
 *
 * The rules are intentionally narrow and statistic-free: no z-score
 * machinery, no rolling baselines stored in a table. Each rule computes
 * its own window-on-window comparison from kpi_daily / campaign_snapshots
 * / requests / notifications. This keeps each rule independently
 * deletable and makes the firing logic visible in one screen of code.
 *
 * Severity ladder (used by all rules):
 *   info     : noteworthy but not actionable
 *   warn     : small deviation; default action steps from rule suffice
 *   high     : clear deviation; default action steps from rule suffice
 *   extreme  : multi-signal or far-tail; eligible for AI enrichment
 *
 * Only "extreme" candidates set `aiEnrich = true`. Everything else stays
 * rule-only to keep the API spend near zero and the surface predictable.
 */

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Round to 4 decimal places: matches numeric(_, 4) column precision. */
function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Round to 2 decimal places, for currency-like values. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------
// Rule 1: No-Show-Rate spike (kpi_daily.noShowRate)
// ---------------------------------------------------------------

/**
 * Compares mean noShowRate over the last 7 days vs the 30 days before that.
 * Severity by absolute percentage-point delta:
 *   +1pp  → info
 *   +2pp  → warn
 *   +4pp  → high
 *   +6pp  → extreme
 *
 * Gate: at least 14 days of baseline data AND current 7-day rate > 5%.
 * Below 5% absolute is too noisy to act on regardless of the lift.
 */
export async function ruleNoShowSpike(
  clinicId: string
): Promise<AlertCandidate[]> {
  const from = daysAgo(37);
  const splitAt = daysAgo(7);

  const rows = await db
    .select({
      date: schema.kpiDaily.date,
      rate: schema.kpiDaily.noShowRate,
      appointments: schema.kpiDaily.appointments,
    })
    .from(schema.kpiDaily)
    .where(
      and(
        eq(schema.kpiDaily.clinicId, clinicId),
        gte(schema.kpiDaily.date, isoDate(from))
      )
    );

  // Weighted mean: each day's noShowRate weighted by appointment count.
  // An unweighted mean would let a single-appointment day with 100% no-show
  // dominate the baseline, generating false alerts.
  let recentApps = 0;
  let recentNoShows = 0;
  let baseApps = 0;
  let baseNoShows = 0;
  let baseDays = 0;
  for (const r of rows) {
    const rate = r.rate != null ? Number(r.rate) : null;
    const apps = r.appointments ?? 0;
    if (rate == null || apps <= 0) continue;
    const ts = new Date(r.date).getTime();
    if (ts >= splitAt.getTime()) {
      recentApps += apps;
      recentNoShows += rate * apps;
    } else {
      baseApps += apps;
      baseNoShows += rate * apps;
      baseDays += 1;
    }
  }

  if (baseDays < 14 || baseApps === 0 || recentApps === 0) return [];

  const recentRate = recentNoShows / recentApps;
  const baseRate = baseNoShows / baseApps;
  if (recentRate < 0.05) return [];

  const deltaPp = (recentRate - baseRate) * 100; // percentage points
  if (deltaPp < 1) return [];

  let severity: AlertSeverity = "info";
  if (deltaPp >= 6) severity = "extreme";
  else if (deltaPp >= 4) severity = "high";
  else if (deltaPp >= 2) severity = "warn";

  const recentPctText = formatPct(recentRate);
  const basePctText = formatPct(baseRate);

  return [
    {
      kind: "no_show_spike",
      severity,
      title: `No-Show-Rate auf ${recentPctText} gestiegen`,
      body: `Letzte 7 Tage: ${recentPctText} (Vorperiode 30 Tage: ${basePctText}).`,
      defaultActionSteps:
        severity === "info"
          ? []
          : [
              "Termin-Erinnerungen (SMS/E-Mail) 24h vorher aktiv prüfen",
              "Letzte 10 No-Shows: gab es Muster (Uhrzeit, Behandlung, Mitarbeiter:in)?",
              "Anzahlung bei Erstterminen erwägen, wenn Quote über 10% bleibt",
            ],
      aiEnrich: severity === "extreme",
      metric: "no_show_rate",
      baselineValue: r4(baseRate),
      observedValue: r4(recentRate),
      dedupeKey: "no_show_spike:rolling-7d",
    },
  ];
}

// ---------------------------------------------------------------
// Rule 2: CPL surge per platform (campaign_snapshots)
// ---------------------------------------------------------------

/**
 * Per platform (meta/google/csv): mean CPL over last 7d vs prior 30d.
 * Severity by % change:
 *   +20% → info
 *   +35% → warn
 *   +60% → high
 *   +100% → extreme
 *
 * Gate: last-7d spend ≥ €50 AND baseline-30d leads ≥ 5. Below those, CPL
 * is too volatile to interpret.
 */
export async function ruleCplSurge(
  clinicId: string
): Promise<AlertCandidate[]> {
  const from = daysAgo(37);
  const splitAt = daysAgo(7);

  const rows = await db
    .select({
      date: schema.campaignSnapshots.snapshotDate,
      platform: schema.campaignSnapshots.platform,
      spend: schema.campaignSnapshots.spendEur,
      leads: schema.campaignSnapshots.leads,
    })
    .from(schema.campaignSnapshots)
    .where(
      and(
        eq(schema.campaignSnapshots.clinicId, clinicId),
        gte(schema.campaignSnapshots.snapshotDate, isoDate(from))
      )
    );

  type Bucket = { spend: number; leads: number };
  const buckets = new Map<
    string,
    { recent: Bucket; base: Bucket }
  >();

  for (const r of rows) {
    const ts = new Date(r.date).getTime();
    const bucketKind: "recent" | "base" =
      ts >= splitAt.getTime() ? "recent" : "base";
    const platform = r.platform;
    const ex = buckets.get(platform) ?? {
      recent: { spend: 0, leads: 0 },
      base: { spend: 0, leads: 0 },
    };
    ex[bucketKind].spend += Number(r.spend ?? 0);
    ex[bucketKind].leads += r.leads ?? 0;
    buckets.set(platform, ex);
  }

  const out: AlertCandidate[] = [];
  for (const [platform, b] of buckets) {
    if (b.recent.spend < 50) continue;
    if (b.base.leads < 5) continue;
    if (b.recent.leads === 0) continue;

    const recentCpl = b.recent.spend / b.recent.leads;
    const baseCpl = b.base.spend / b.base.leads;
    if (baseCpl <= 0) continue;

    const pct = (recentCpl - baseCpl) / baseCpl;
    if (pct < 0.2) continue;

    let severity: AlertSeverity = "info";
    if (pct >= 1.0) severity = "extreme";
    else if (pct >= 0.6) severity = "high";
    else if (pct >= 0.35) severity = "warn";

    out.push({
      kind: "cpl_surge",
      severity,
      title: `CPL ${platformLabel(platform)} ${formatPctChange(pct)} auf ${formatEuro(recentCpl)}`,
      body: `Vorperiode 30 Tage: ${formatEuro(baseCpl)} pro Anfrage.`,
      defaultActionSteps:
        severity === "info"
          ? []
          : [
              "Creatives prüfen: Top-Performer der letzten 30 Tage als Referenz vergleichen",
              "Audience-Saturation prüfen (Frequency > 3 ist Warnsignal)",
              "Bid-Strategie oder Budget kurzfristig anpassen, nicht beide gleichzeitig",
            ],
      aiEnrich: severity === "extreme",
      metric: `cpl:${platform}`,
      baselineValue: r2(baseCpl),
      observedValue: r2(recentCpl),
      dedupeKey: `cpl_surge:${platform}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------
// Rule 3: Lead drought (requests, last 14d)
// ---------------------------------------------------------------

/**
 * Zero leads (non-spam) in the last 14 days while the 30 days before that
 * had at least 5. Pure silence detector; severity is based on what the
 * praxis was getting before things went quiet:
 *   prior >= 5 → warn
 *   prior >= 15 → high
 *   prior >= 40 → extreme
 */
export async function ruleLeadDrought(
  clinicId: string
): Promise<AlertCandidate[]> {
  const recentFrom = daysAgo(14);
  const baseFrom = daysAgo(44);

  const recentRow = await db
    .select({ c: count() })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        gte(schema.requests.createdAt, recentFrom),
        sql`${schema.requests.status} <> 'spam'`
      )
    );

  const baseRow = await db
    .select({ c: count() })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        gte(schema.requests.createdAt, baseFrom),
        lt(schema.requests.createdAt, recentFrom),
        sql`${schema.requests.status} <> 'spam'`
      )
    );

  const recent = Number(recentRow[0]?.c ?? 0);
  const base = Number(baseRow[0]?.c ?? 0);

  if (recent > 0) return [];
  if (base < 5) return [];

  let severity: AlertSeverity = "warn";
  if (base >= 40) severity = "extreme";
  else if (base >= 15) severity = "high";

  return [
    {
      kind: "lead_drought",
      severity,
      title: "14 Tage ohne neue Anfrage",
      body: `In den 30 Tagen davor: ${base} Anfragen. Aktuell: 0.`,
      defaultActionSteps: [
        "Anzeigen-Auslieferung prüfen: läuft Meta + Google aktuell?",
        "Landingpage testen: Formular erreichbar, kein 4xx auf der Tracking-URL?",
        "Letzte Änderungen rückwärts laufen lassen (Audience, Bid, Creative der letzten 14 Tage)",
      ],
      aiEnrich: severity === "extreme",
      metric: "leads_14d",
      baselineValue: base,
      observedValue: 0,
      dedupeKey: "lead_drought:rolling-14d",
    },
  ];
}

// ---------------------------------------------------------------
// Rule 4: Revenue drop (kpi_daily.revenueAttributedEur)
// ---------------------------------------------------------------

/**
 * Last 7d revenue vs prior-30d daily average × 7. Trigger when drop ≥ 25%
 * AND prior baseline ≥ €500/week (avoid alerting brand-new clinics).
 *   -25% → warn
 *   -40% → high
 *   -60% → extreme
 */
export async function ruleRevenueDrop(
  clinicId: string
): Promise<AlertCandidate[]> {
  const from = daysAgo(37);
  const splitAt = daysAgo(7);

  const rows = await db
    .select({
      date: schema.kpiDaily.date,
      revenue: schema.kpiDaily.revenueAttributedEur,
    })
    .from(schema.kpiDaily)
    .where(
      and(
        eq(schema.kpiDaily.clinicId, clinicId),
        gte(schema.kpiDaily.date, isoDate(from))
      )
    );

  let recent = 0;
  let base = 0;
  let baseDays = 0;
  for (const r of rows) {
    const rev = r.revenue != null ? Number(r.revenue) : 0;
    const ts = new Date(r.date).getTime();
    if (ts >= splitAt.getTime()) {
      recent += rev;
    } else {
      base += rev;
      baseDays += 1;
    }
  }

  if (baseDays < 14) return [];
  const baseExpected = (base / baseDays) * 7;
  if (baseExpected < 500) return [];

  const pct = (recent - baseExpected) / baseExpected;
  if (pct > -0.25) return [];

  let severity: AlertSeverity = "warn";
  if (pct <= -0.6) severity = "extreme";
  else if (pct <= -0.4) severity = "high";

  return [
    {
      kind: "revenue_drop",
      severity,
      title: `Umsatz ${formatPctChange(pct)} vs. Vorperiode`,
      body: `Letzte 7 Tage: ${formatEuro(recent)}, erwartet (30-Tage-Schnitt): ${formatEuro(baseExpected)}.`,
      defaultActionSteps:
        severity === "warn"
          ? [
              "Gewonnen-Quote in /auswertung prüfen: fehlen Abschlüsse oder fehlen Anfragen?",
              "Wenn Anfragen okay: Beratungs-Show-Rate und Angebote prüfen",
            ]
          : [
              "Pipeline-Vorhersage in /auswertung prüfen: ist die Lücke schon im Forecast?",
              "Top-Behandlungen Vorjahr vs. aktuell: welche fehlt?",
              "Anfragen-Reaktionszeit prüfen: gibt es Verzögerungen, die Abschlüsse kosten?",
            ],
      aiEnrich: severity === "extreme",
      metric: "revenue_7d",
      baselineValue: r2(baseExpected),
      observedValue: r2(recent),
      dedupeKey: "revenue_drop:rolling-7d",
    },
  ];
}

// ---------------------------------------------------------------
// Rule 5: SLA-breach trend (notifications.kind = sla_breach)
// ---------------------------------------------------------------

/**
 * SLA-breach notifications in the last 7d. Alert when count exceeds 3 AND
 * is at least 2× the prior week. The SLA-check worker already creates
 * per-request notifications; this rule converts the count into a
 * dashboard-level trend signal.
 *
 * Notifications fan out to all inhaber + frontdesk users, so we count
 * DISTINCT links (one link = one breaching request).
 */
export async function ruleSlaBreachTrend(
  clinicId: string
): Promise<AlertCandidate[]> {
  const recentFrom = daysAgo(7);
  const baseFrom = daysAgo(14);

  const recentRow = await db
    .select({
      c: sql<number>`count(distinct ${schema.notifications.link})::int`,
    })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.clinicId, clinicId),
        eq(schema.notifications.kind, "sla_breach"),
        gte(schema.notifications.createdAt, recentFrom)
      )
    );

  const baseRow = await db
    .select({
      c: sql<number>`count(distinct ${schema.notifications.link})::int`,
    })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.clinicId, clinicId),
        eq(schema.notifications.kind, "sla_breach"),
        gte(schema.notifications.createdAt, baseFrom),
        lt(schema.notifications.createdAt, recentFrom)
      )
    );

  const recent = Number(recentRow[0]?.c ?? 0);
  const base = Number(baseRow[0]?.c ?? 0);

  if (recent <= 3) return [];
  if (recent < base * 2) return [];

  let severity: AlertSeverity = "warn";
  if (recent >= 12) severity = "extreme";
  else if (recent >= 7) severity = "high";

  return [
    {
      kind: "sla_breach_trend",
      severity,
      title: `${recent} Reaktions-Überschreitungen in 7 Tagen`,
      body: `Vorwoche: ${base}. SLA-Frist (Reaktionszeit) wurde wiederholt verpasst.`,
      defaultActionSteps: [
        "Posteingang aufräumen: offene Anfragen unter /anfragen?status=neu zuerst",
        "Zuweisungs-Regeln in /einstellungen prüfen: bekommt jede Anfrage einen Owner?",
        "Wenn Volumen unerwartet hoch: Frontdesk-Kapazität auf der Woche verstärken",
      ],
      aiEnrich: severity === "extreme",
      metric: "sla_breaches_7d",
      baselineValue: base,
      observedValue: recent,
      dedupeKey: "sla_breach_trend:rolling-7d",
    },
  ];
}

// ---------------------------------------------------------------
// Multi-signal combiner: boosts CPL-surge to extreme when revenue also
// drops in the same window. The combination is the classic "creative
// fatigue / audience burn" pattern; the LLM enricher gets to weigh in
// because rules alone can't tell whether it's fatigue, seasonality, or
// market-level competition.
// ---------------------------------------------------------------
export function combineMultiSignal(
  candidates: AlertCandidate[]
): AlertCandidate[] {
  const hasCplSurge = candidates.some((c) => c.kind === "cpl_surge");
  const hasRevenueDrop = candidates.some((c) => c.kind === "revenue_drop");
  if (!hasCplSurge || !hasRevenueDrop) return candidates;

  return candidates.map((c) => {
    if (c.kind !== "cpl_surge" && c.kind !== "revenue_drop") return c;
    if (c.severity === "extreme") return { ...c, aiEnrich: true };
    return { ...c, severity: "extreme" as const, aiEnrich: true };
  });
}

// ---------------------------------------------------------------
// Registry
// ---------------------------------------------------------------
export const ALL_RULES: Array<(clinicId: string) => Promise<AlertCandidate[]>> = [
  ruleNoShowSpike,
  ruleCplSurge,
  ruleLeadDrought,
  ruleRevenueDrop,
  ruleSlaBreachTrend,
];

// ---------------------------------------------------------------
// Formatters. All German-facing copy lives here so the rule bodies stay
// data-focused.
// ---------------------------------------------------------------

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1).replace(".", ",")}%`;
}

function formatPctChange(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}

function formatEuro(n: number): string {
  return `${n
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
}

function platformLabel(p: string): string {
  if (p === "meta") return "Meta";
  if (p === "google") return "Google";
  if (p === "csv") return "CSV";
  return p;
}
