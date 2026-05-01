import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  TrafficLightCard,
  ProgressGoal,
  Button,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import {
  currentMonthSummary,
  currentGoals,
} from "@/server/queries/kpis";
import {
  recentRequestsCount,
  requestStatusCounts,
  slaBreachedCount,
} from "@/server/queries/requests";
import {
  formatRoasSentence,
} from "@/lib/formatting";
import { DashboardTopMetricsSimple } from "./_components/DashboardTopMetricsSimple";
import { DashboardTopMetricsEnhanced } from "./_components/DashboardTopMetricsEnhanced";
import { DashboardDetailBundle } from "./_components/DashboardDetailBundle";
import { DetailBundleSkeleton } from "./_components/DetailBundleSkeleton";

export const metadata = { title: "Übersicht" };

export default async function DashboardPage() {
  const session = await requireSession();
  const isDetail = session.uiMode === "detail";

  // Base bundle — always small (5 queries). The detail bundle (8 more) is
  // streamed inside <Suspense> so the shell paints before the deep-dive
  // queries finish.
  const [summary, goals, statusCounts, slaBreaches, newToday] = await Promise.all([
    currentMonthSummary(session.clinicId, session.userId),
    currentGoals(session.clinicId, session.userId),
    requestStatusCounts(session.clinicId, session.userId),
    slaBreachedCount(session.clinicId, session.userId),
    recentRequestsCount(session.clinicId, session.userId, 1),
  ]);

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

      {/* Top metrics — Detail streams the enriched MetricTile grid; the base
          SimpleMetric grid is the Suspense fallback so it paints immediately. */}
      {isDetail ? (
        <Suspense
          fallback={
            <DashboardTopMetricsSimple
              summary={summary}
              slaBreaches={slaBreaches}
              openRequests={openRequests}
              leadsGoal={leadsGoal}
              revenueGoal={revenueGoal}
            />
          }
        >
          <DashboardTopMetricsEnhanced
            clinicId={session.clinicId}
            userId={session.userId}
            summary={summary}
            slaBreaches={slaBreaches}
            openRequests={openRequests}
            leadsGoal={leadsGoal}
            revenueGoal={revenueGoal}
          />
        </Suspense>
      ) : (
        <DashboardTopMetricsSimple
          summary={summary}
          slaBreaches={slaBreaches}
          openRequests={openRequests}
          leadsGoal={leadsGoal}
          revenueGoal={revenueGoal}
        />
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

      {/* Ampel-Cards — render with base data only, no detail dependency. */}
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

      {/* Detail-mode deep dive — streamed inside Suspense so the shell paints
          before its 8 parallel queries finish. */}
      {isDetail && (
        <Suspense fallback={<DetailBundleSkeleton />}>
          <DashboardDetailBundle
            clinicId={session.clinicId}
            userId={session.userId}
            summary={summary}
          />
        </Suspense>
      )}
    </div>
  );
}
