import Link from "next/link";
import { ArrowUpRight, Star } from "lucide-react";
import {
  SimpleMetric,
  TrafficLightCard,
  ProgressGoal,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  MetricTile,
  Sparkline,
  Badge,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import {
  currentMonthSummary,
  currentGoals,
  kpiSummaryWithComparison,
  kpiDailySeriesWithSparkline,
} from "@/server/queries/kpis";
import {
  recentRequestsCount,
  requestStatusCounts,
  slaBreachedCount,
} from "@/server/queries/requests";
import { bySource } from "@/server/queries/attribution";
import {
  responseTimeStats,
  staffPerformance,
} from "@/server/queries/lifecycle";
import { recallsDue } from "@/server/queries/patients";
import { latestReviews } from "@/server/queries/reviews";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import {
  formatEuro,
  formatNumber,
  formatRoasSentence,
  formatMinutes,
  formatPercent,
  toneForGoalRatio,
  deltaTone,
} from "@/lib/formatting";
import {
  SOURCE_LABELS,
  type RequestSource,
} from "@/lib/constants";
import { BreakdownBars } from "../auswertung/_components/detail-helpers";

export const metadata = { title: "Übersicht" };

export default async function DashboardPage() {
  const session = await requireSession();
  const isDetail = session.uiMode === "detail";

  const [summary, goals, statusCounts, slaBreaches, newToday] = await Promise.all([
    currentMonthSummary(session.clinicId, session.userId),
    currentGoals(session.clinicId, session.userId),
    requestStatusCounts(session.clinicId, session.userId),
    slaBreachedCount(session.clinicId, session.userId),
    recentRequestsCount(session.clinicId, session.userId, 1),
  ]);

  // Detail bundle: only fetched when uiMode === detail.
  const detail = isDetail ? await fetchDetail(session.clinicId, session.userId) : null;

  const leadsGoal = goals.find((g) => g.metric === "qualified_leads");
  const revenueGoal = goals.find((g) => g.metric === "revenue");

  const openRequests =
    (statusCounts.neu ?? 0) + (statusCounts.qualifiziert ?? 0);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-secondary">Guten Tag,</p>
          <h1 className="text-3xl font-semibold md:text-4xl">
            {session.fullName ?? session.email.split("@")[0]}.
          </h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            So läuft es aktuell in Ihrer Praxis.
          </p>
        </div>
        <div className="text-sm text-fg-secondary">
          {new Date().toLocaleDateString("de-DE", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </div>
      </div>

      {/* Top metrics — Detail uses MetricTile with delta + sparkline. */}
      {isDetail && detail ? (
        <section aria-label="Monatszahlen" className="grid gap-4 md:grid-cols-3">
          <MetricTile
            label="Qualifizierte Anfragen"
            value={formatNumber(summary.qualifiedLeads)}
            sublabel={
              leadsGoal
                ? `Monatsziel: ${Number(leadsGoal.targetValue)} · ${summary.casesWon} gewonnen`
                : `${summary.casesWon} bisher gewonnen`
            }
            tone={
              leadsGoal
                ? toneForGoalRatio(summary.qualifiedLeads / Number(leadsGoal.targetValue))
                : "accent"
            }
            delta={
              detail.comparison.delta.qualifiedLeadsPct != null
                ? {
                    value: (detail.comparison.delta.qualifiedLeadsPct ?? 0) * 100,
                    tone: deltaTone(detail.comparison.delta.qualifiedLeadsPct),
                  }
                : undefined
            }
            sparkline={detail.spark.qualifiedLeads}
            hint="vs. Vormonat"
          />
          <MetricTile
            label="Umsatz in diesem Monat"
            value={formatEuro(summary.revenueEur)}
            sublabel={
              revenueGoal
                ? `Monatsziel: ${formatEuro(Number(revenueGoal.targetValue))}`
                : formatRoasSentence(summary.roas)
            }
            tone={
              revenueGoal
                ? toneForGoalRatio(summary.revenueEur / Number(revenueGoal.targetValue))
                : "accent"
            }
            delta={
              detail.comparison.delta.revenuePct != null
                ? {
                    value: (detail.comparison.delta.revenuePct ?? 0) * 100,
                    tone: deltaTone(detail.comparison.delta.revenuePct),
                  }
                : undefined
            }
            sparkline={detail.spark.revenueEur}
            hint="vs. Vormonat"
          />
          <MetricTile
            label="Offene Anfragen"
            value={formatNumber(openRequests)}
            tone={slaBreaches > 0 ? "bad" : openRequests > 0 ? "warn" : "good"}
            sublabel={
              slaBreaches > 0
                ? `${slaBreaches} davon überfällig`
                : openRequests > 0
                ? "warten auf erste Reaktion"
                : "alles auf aktuellem Stand"
            }
            sparkline={detail.spark.qualifiedLeads}
          />
        </section>
      ) : (
        <section aria-label="Monatszahlen" className="grid gap-4 md:grid-cols-3">
          <SimpleMetric
            label="Qualifizierte Anfragen"
            value={formatNumber(summary.qualifiedLeads)}
            tone={
              leadsGoal
                ? toneForGoalRatio(summary.qualifiedLeads / Number(leadsGoal.targetValue))
                : "neutral"
            }
            explanation={
              leadsGoal
                ? `Monatsziel: ${Number(leadsGoal.targetValue)} Anfragen.`
                : "Ernstgemeinte Anfragen im laufenden Monat."
            }
          />
          <SimpleMetric
            label="Umsatz in diesem Monat"
            value={formatEuro(summary.revenueEur)}
            tone={
              revenueGoal
                ? toneForGoalRatio(summary.revenueEur / Number(revenueGoal.targetValue))
                : "neutral"
            }
            explanation={
              revenueGoal
                ? `Monatsziel: ${formatEuro(Number(revenueGoal.targetValue))}.`
                : formatRoasSentence(summary.roas)
            }
          />
          <SimpleMetric
            label="Offene Anfragen"
            value={formatNumber(openRequests)}
            tone={slaBreaches > 0 ? "bad" : openRequests > 0 ? "warn" : "good"}
            explanation={
              slaBreaches > 0
                ? `${slaBreaches} davon überfällig. Bitte heute anrufen.`
                : openRequests > 0
                ? "Diese Anfragen warten auf eine erste Reaktion."
                : "Alles auf aktuellem Stand."
            }
          />
        </section>
      )}

      {/* Goals */}
      {(leadsGoal || revenueGoal) && (
        <section className="grid gap-4 md:grid-cols-2">
          {leadsGoal && (
            <ProgressGoal
              label="Monatsziel Anfragen"
              current={summary.qualifiedLeads}
              target={Number(leadsGoal.targetValue)}
              unit="Anfragen"
            />
          )}
          {revenueGoal && (
            <ProgressGoal
              label="Monatsziel Umsatz"
              current={Math.round(summary.revenueEur)}
              target={Number(revenueGoal.targetValue)}
              unit="€"
            />
          )}
        </section>
      )}

      {/* Ampel-Cards */}
      <section className="grid gap-4 md:grid-cols-3">
        <TrafficLightCard
          tone={slaBreaches > 0 ? "bad" : "good"}
          title="Anfragen-Reaktion"
          diagnosis={
            slaBreaches > 0
              ? `${slaBreaches} Anfragen warten länger als vereinbart auf Antwort.`
              : "Alle Anfragen wurden pünktlich beantwortet."
          }
          action={
            slaBreaches > 0 ? (
              <Button asChild size="sm">
                <Link href="/anfragen?slaBreached=1">Jetzt bearbeiten</Link>
              </Button>
            ) : undefined
          }
        />
        <TrafficLightCard
          tone={newToday > 0 ? "good" : "neutral"}
          title="Heute neu eingegangen"
          diagnosis={
            newToday > 0
              ? `${newToday} neue Anfrage${newToday === 1 ? "" : "n"} in den letzten 24 Stunden.`
              : "Heute noch keine neuen Anfragen eingegangen."
          }
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/anfragen">
                Alle ansehen <ArrowUpRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          }
        />
        <TrafficLightCard
          tone={
            summary.roas === null
              ? "neutral"
              : summary.roas >= 3
              ? "good"
              : summary.roas >= 1.5
              ? "warn"
              : "bad"
          }
          title="Werbeertrag"
          diagnosis={formatRoasSentence(summary.roas)}
        />
      </section>

      {/* ---------- Detail-mode deep dive ---------- */}
      {isDetail && detail && (
        <>
          <Card className="print:break-inside-avoid">
            <CardHeader>
              <CardTitle>Tagesverlauf · 14 Tage</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <DailyMini
                label="Anfragen"
                values={detail.spark.qualifiedLeads.slice(-14)}
                tone="accent"
              />
              <DailyMini
                label="Behandlungen gewonnen"
                values={detail.spark.casesWon.slice(-14)}
                tone="good"
              />
              <DailyMini
                label="Umsatz"
                values={detail.spark.revenueEur.slice(-14)}
                tone="accent"
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Quellen-Aufschlüsselung</CardTitle>
              </CardHeader>
              <CardContent>
                {detail.sourceBreakdown.length > 0 ? (
                  <BreakdownBars
                    rows={detail.sourceBreakdown.slice(0, 6).map((c) => ({
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
                    detail.responseTime.avgMinutes == null
                      ? "neutral"
                      : detail.responseTime.avgMinutes < 60
                      ? "good"
                      : detail.responseTime.avgMinutes < 240
                      ? "warn"
                      : "bad"
                  }
                  title={`Ø ${formatMinutes(detail.responseTime.avgMinutes)}`}
                  diagnosis={
                    detail.responseTime.totalAnswered === 0
                      ? "Noch keine Reaktionsdaten im Monat."
                      : `${formatNumber(detail.responseTime.totalAnswered)} Antworten · P90 ${formatMinutes(
                          detail.responseTime.p90Minutes
                        )} · ${formatPercent(detail.responseTime.slaBreachRate ?? 0)} SLA-Bruch`
                  }
                />
              </CardContent>
            </Card>
          </div>

          {detail.staff.length > 0 && (
            <Card className="print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Mitarbeiter-Performance · diesen Monat</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {detail.staff.map((s) => (
                    <li
                      key={s.userId}
                      className="grid grid-cols-[1fr_repeat(4,minmax(0,5rem))] items-center gap-4 py-3 text-sm"
                    >
                      <span>
                        <span className="font-medium text-fg-primary">
                          {s.fullName ?? s.email}
                        </span>
                        <span className="ml-2 text-xs text-fg-secondary">
                          ({s.role})
                        </span>
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

          {/* Sync status + reputation + recalls */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Werbe-Sync</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.creds.length === 0 && (
                  <p className="text-sm text-fg-secondary">
                    Noch keine Werbekonten verbunden.
                  </p>
                )}
                {detail.creds.map((c) => (
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
                {detail.reviews.length === 0 ? (
                  <p className="text-sm text-fg-secondary">
                    Noch keine Bewertungen erfasst.
                  </p>
                ) : (
                  detail.reviews.map((r) => (
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
                {detail.recalls.length === 0 ? (
                  <p className="text-sm text-fg-secondary">
                    Keine Recalls in den nächsten 30 Tagen.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {detail.recalls.slice(0, 5).map((r) => (
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

          {/* Funnel detail block (preserved from old detail) */}
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
      )}
    </div>
  );
}

async function fetchDetail(clinicId: string, userId: string) {
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

  return {
    comparison,
    spark: sparkData.sparklines,
    sourceBreakdown,
    responseTime,
    staff,
    recalls,
    reviews,
    creds,
  };
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
