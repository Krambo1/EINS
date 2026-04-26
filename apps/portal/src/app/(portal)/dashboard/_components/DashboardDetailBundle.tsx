import "server-only";
import { Star } from "lucide-react";
import { eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TrafficLightCard,
  Sparkline,
  Badge,
} from "@eins/ui";
import { db, schema } from "@/db/client";
import {
  kpiSummaryWithComparison,
  kpiDailySeriesWithSparkline,
} from "@/server/queries/kpis";
import { bySource } from "@/server/queries/attribution";
import {
  responseTimeStats,
  staffPerformance,
} from "@/server/queries/lifecycle";
import { recallsDue } from "@/server/queries/patients";
import { latestReviews } from "@/server/queries/reviews";
import {
  formatEuro,
  formatNumber,
  formatMinutes,
  formatPercent,
} from "@/lib/formatting";
import {
  SOURCE_LABELS,
  type RequestSource,
} from "@/lib/constants";
import { BreakdownBars } from "../../auswertung/_components/detail-helpers";
import type { KpiSummary } from "@/server/queries/kpis";

/**
 * Async server component rendered inside a <Suspense>. Fetches the deep-dive
 * detail bundle (8 parallel queries) and renders the cards that show beyond
 * the base shell. The base shell paints immediately while these queries run.
 *
 * The TTFB win: the <h1>, base SimpleMetric grid, traffic-light cards, and
 * goals all paint before this bundle's queries finish. On a cold detail-mode
 * load that previously blocked on max-of-13 queries before any bytes flushed,
 * the shell now blocks on max-of-5.
 */
export async function DashboardDetailBundle({
  clinicId,
  userId,
  summary,
}: {
  clinicId: string;
  userId: string;
  summary: KpiSummary;
}) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const sparkFrom = new Date();
  sparkFrom.setDate(sparkFrom.getDate() - 30);

  const [comparison, sparkData, sourceBreakdown, responseTime, staff, recalls, reviews, creds] =
    await Promise.all([
      kpiSummaryWithComparison(clinicId, userId, monthStart, monthEnd),
      kpiDailySeriesWithSparkline(clinicId, userId, sparkFrom, now),
      bySource(clinicId, userId, monthStart, monthEnd),
      responseTimeStats(clinicId, userId, monthStart, monthEnd),
      staffPerformance(clinicId, userId, monthStart, monthEnd),
      recallsDue(clinicId, userId, 30),
      latestReviews(clinicId, userId),
      db
        .select({
          platform: schema.platformCredentials.platform,
          lastSyncedAt: schema.platformCredentials.lastSyncedAt,
          lastSyncError: schema.platformCredentials.lastSyncError,
        })
        .from(schema.platformCredentials)
        .where(eq(schema.platformCredentials.clinicId, clinicId)),
    ]);

  void comparison; // currently consumed only by the top-metrics enhanced tile path

  const spark = sparkData.sparklines;

  return (
    <>
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Tagesverlauf · 14 Tage</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <DailyMini label="Anfragen" values={spark.qualifiedLeads.slice(-14)} tone="accent" />
          <DailyMini
            label="Behandlungen gewonnen"
            values={spark.casesWon.slice(-14)}
            tone="good"
          />
          <DailyMini label="Umsatz" values={spark.revenueEur.slice(-14)} tone="accent" />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Quellen-Aufschlüsselung</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceBreakdown.length > 0 ? (
              <BreakdownBars
                rows={sourceBreakdown.slice(0, 6).map((c) => ({
                  label: SOURCE_LABELS[c.source as RequestSource] ?? c.source,
                  value: c.leads,
                  hint: (
                    <>
                      {formatNumber(c.leads)}
                      {c.spendEur != null && (
                        <span className="text-fg-tertiary">
                          {" "}
                          · {formatEuro(c.spendEur)}
                        </span>
                      )}
                    </>
                  ),
                  tone:
                    c.source === "meta"
                      ? "accent"
                      : c.source === "google"
                      ? "good"
                      : "neutral",
                }))}
              />
            ) : (
              <p className="py-4 text-sm text-fg-secondary">Keine Quellen-Daten.</p>
            )}
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Reaktionszeit</CardTitle>
          </CardHeader>
          <CardContent>
            <TrafficLightCard
              tone={
                responseTime.avgMinutes == null
                  ? "neutral"
                  : responseTime.avgMinutes < 60
                  ? "good"
                  : responseTime.avgMinutes < 240
                  ? "warn"
                  : "bad"
              }
              title={`Ø ${formatMinutes(responseTime.avgMinutes)}`}
              diagnosis={
                responseTime.totalAnswered === 0
                  ? "Noch keine Reaktionsdaten im Monat."
                  : `${formatNumber(responseTime.totalAnswered)} Antworten · P90 ${formatMinutes(
                      responseTime.p90Minutes
                    )} · ${formatPercent(responseTime.slaBreachRate ?? 0)} SLA-Bruch`
              }
            />
          </CardContent>
        </Card>
      </div>

      {staff.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Mitarbeiter-Performance · diesen Monat</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {staff.map((s) => (
                <li
                  key={s.userId}
                  className="grid grid-cols-[1fr_repeat(4,minmax(0,5rem))] items-center gap-4 py-3 text-sm"
                >
                  <span>
                    <span className="font-medium text-fg-primary">
                      {s.fullName ?? s.email}
                    </span>
                    <span className="ml-2 text-xs text-fg-secondary">({s.role})</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {formatNumber(s.assignedCount)}
                  </span>
                  <span className="text-right tabular-nums">
                    {formatNumber(s.wonCount)}
                  </span>
                  <span className="text-right tabular-nums">
                    {s.winRate != null ? formatPercent(s.winRate) : "–"}
                  </span>
                  <span className="text-right tabular-nums text-fg-secondary">
                    {formatMinutes(s.avgResponseMinutes)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 grid grid-cols-[1fr_repeat(4,minmax(0,5rem))] gap-4 text-[10px] uppercase tracking-wide text-fg-tertiary">
              <span>&nbsp;</span>
              <span className="text-right">Zugewiesen</span>
              <span className="text-right">Gewonnen</span>
              <span className="text-right">Quote</span>
              <span className="text-right">Ø Reaktion</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Werbe-Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {creds.length === 0 && (
              <p className="text-sm text-fg-secondary">
                Noch keine Werbekonten verbunden.
              </p>
            )}
            {creds.map((c) => (
              <div
                key={c.platform}
                className="flex items-center justify-between rounded-md border border-border bg-bg-secondary/40 p-3"
              >
                <div>
                  <div className="text-sm font-medium capitalize text-fg-primary">
                    {c.platform === "meta" ? "Meta" : "Google"}
                  </div>
                  <div className="text-xs text-fg-secondary">
                    {c.lastSyncedAt
                      ? `Letzter Abgleich: ${formatRelativeMins(c.lastSyncedAt)}`
                      : "noch nie"}
                  </div>
                </div>
                {c.lastSyncError ? (
                  <Badge tone="bad">Fehler</Badge>
                ) : c.lastSyncedAt ? (
                  <Badge tone="good">OK</Badge>
                ) : (
                  <Badge tone="neutral">Wartet</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Reputation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reviews.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                Noch keine Bewertungen erfasst.
              </p>
            ) : (
              reviews.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="capitalize text-fg-primary">{r.platform}</span>
                  <span className="flex items-center gap-1 font-medium tabular-nums">
                    {r.rating.toFixed(1).replace(".", ",")}
                    <Star className="h-3.5 w-3.5 text-tone-warn" />
                    <span className="ml-1 text-xs text-fg-secondary">
                      ({r.totalCount})
                    </span>
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Recalls fällig</CardTitle>
          </CardHeader>
          <CardContent>
            {recalls.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                Keine Recalls in den nächsten 30 Tagen.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recalls.slice(0, 5).map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">
                      <span className="font-medium text-fg-primary">
                        {r.patientName ?? r.patientEmail ?? "Unbekannt"}
                      </span>
                      <span className="ml-2 text-xs text-fg-secondary">
                        ({recallKindLabel(r.kind)})
                      </span>
                    </span>
                    <span className="text-xs text-fg-secondary tabular-nums">
                      {new Date(r.scheduledFor).toLocaleDateString("de-DE")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Trichter-Übersicht</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-4">
          <DetailBox
            label="Termine"
            value={formatNumber(summary.appointments)}
            hint={
              summary.qualifiedLeads > 0
                ? `${formatPercent(summary.appointments / summary.qualifiedLeads)} der Anfragen`
                : null
            }
          />
          <DetailBox
            label="Beratungen gehalten"
            value={formatNumber(summary.consultationsHeld)}
            hint={
              summary.appointments > 0
                ? `${formatPercent(
                    summary.consultationsHeld / summary.appointments
                  )} der Termine`
                : null
            }
          />
          <DetailBox
            label="Behandlungen gewonnen"
            value={formatNumber(summary.casesWon)}
            hint={
              summary.consultationsHeld > 0
                ? `${formatPercent(summary.casesWon / summary.consultationsHeld)} der Beratungen`
                : null
            }
          />
          <DetailBox
            label="Kosten je qualifizierter Anfrage"
            value={
              summary.costPerQualifiedLead !== null
                ? formatEuro(summary.costPerQualifiedLead)
                : "–"
            }
            hint={null}
          />
        </CardContent>
      </Card>
    </>
  );
}

function recallKindLabel(kind: string): string {
  switch (kind) {
    case "recall":
      return "Recall";
    case "followup":
      return "Followup";
    case "review_request":
      return "Bewertung";
    default:
      return kind;
  }
}

function formatRelativeMins(d: Date): string {
  const diffMin = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (diffMin < 60) return `vor ${diffMin} Min`;
  if (diffMin < 60 * 24) return `vor ${Math.round(diffMin / 60)} Std`;
  return `vor ${Math.round(diffMin / 60 / 24)} Tagen`;
}

function DailyMini({
  label,
  values,
  tone,
}: {
  label: string;
  values: number[];
  tone: "accent" | "good" | "warn" | "bad" | "neutral";
}) {
  const total = values.reduce((s, v) => s + v, 0);
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {formatNumber(total)}
      </div>
      <Sparkline values={values} tone={tone} height={56} />
    </div>
  );
}

function DetailBox({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-fg-tertiary">{hint}</div>}
    </div>
  );
}
