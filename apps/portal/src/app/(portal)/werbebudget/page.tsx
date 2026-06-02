import Link from "next/link";
import { eq } from "drizzle-orm";
import { requirePermissionOrRedirect } from "@/auth/guards";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Button,
  Badge,
  TrendChart,
  type TrendChartTone,
  type TrendChartValueFormat,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  cn,
} from "@eins/ui";
import { campaignLiveSummary } from "@/server/queries/kpis";
import {
  campaignDailyByPlatform,
  campaignsForPeriod,
  syncHistory,
  spendPaceProjection,
} from "@/server/queries/campaigns";
import { db, schema } from "@/db/client";
import {
  formatEuro,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/formatting";
import { AlertTriangle, Link as LinkIcon, Plug } from "lucide-react";
import { DataTable } from "../dashboard/_components/detail-helpers";
import { Brand } from "@/app/_components/Brand";

export const metadata = { title: "Werbebudget Live" };

type Search = { days?: string };

const PLATFORM_LABELS: Record<"meta" | "google", React.ReactNode> = {
  meta: <Brand brand="meta">Meta · Facebook & Instagram</Brand>,
  google: <Brand brand="google">Google Ads</Brand>,
};

/**
 * Shared elevated-card surface. Matches the dashboard's MetricTile /
 * ForecastStrip look (soft off-white fill that lifts via shadow) so the
 * Werbebudget tab reads as the same product instead of flat grey boxes.
 */
const CARD_SURFACE = {
  backgroundColor: "var(--bg-card)",
  boxShadow: "var(--shadow-card)",
} as const;

export default async function WerbebudgetPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePermissionOrRedirect("campaigns.live");
  const params = await searchParams;
  const days = Math.max(7, Math.min(90, Number(params.days ?? 30)));

  const [live, creds, detail] = await Promise.all([
    campaignLiveSummary(session.clinicId, session.userId, days),
    db
      .select({
        platform: schema.platformCredentials.platform,
        accountId: schema.platformCredentials.accountId,
        lastSyncedAt: schema.platformCredentials.lastSyncedAt,
        lastSyncError: schema.platformCredentials.lastSyncError,
      })
      .from(schema.platformCredentials)
      .where(eq(schema.platformCredentials.clinicId, session.clinicId)),
    fetchDetail(session.clinicId, session.userId, days),
  ]);

  const totalSpend = live.reduce((sum, r) => sum + r.spendEur, 0);
  const totalLeads = live.reduce((sum, r) => sum + r.leads, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : null;

  const metaCred = creds.find((c) => c.platform === "meta");
  const googleCred = creds.find((c) => c.platform === "google");

  const noIntegrations = !metaCred && !googleCred;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Werbebudget Live.</h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            Was Sie investiert haben und was dabei herauskommt. Aktuelle Zahlen
            direkt aus Meta und Google.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Zeitraum"
          className="inline-flex items-center gap-0.5 rounded-full border border-border bg-bg-secondary p-1"
        >
          {[7, 30, 90].map((d) => {
            const active = days === d;
            return (
              <Link
                key={d}
                href={`/werbebudget?days=${d}`}
                role="tab"
                aria-selected={active}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium tabular-nums transition-colors",
                  active
                    ? "bg-fg-primary text-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.18)]"
                    : "text-fg-secondary hover:text-fg-primary"
                )}
              >
                {d} Tage
              </Link>
            );
          })}
        </div>
      </header>

      {noIntegrations ? (
        <EmptyState
          icon={<Plug className="h-8 w-8" />}
          title="Noch keine Werbekonten verbunden"
          description="Verbinden Sie Meta und Google, damit Sie Ihr Budget und die Ergebnisse hier live sehen."
          action={
            <Button asChild>
              <Link href="/einstellungen/integrationen">
                <LinkIcon className="h-4 w-4" />
                Jetzt verbinden
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatStrip
            size="lg"
            title="Insgesamt"
            stats={[
              {
                label: "Budget",
                value: formatEuro(totalSpend),
              },
              {
                label: "Anfragen über Werbung",
                value: formatNumber(totalLeads),
              },
              {
                label: "Ø Kosten je Anfrage",
                value: avgCpl !== null ? formatEuro(avgCpl) : "–",
              },
            ]}
          />

          {detail?.pace && (
            <StatStrip
              title="Hochrechnung (Pace)"
              stats={[
                {
                  label: "Bisher diesen Monat ausgegeben",
                  value: formatEuro(detail.pace.monthSpendSoFar),
                },
                {
                  label: `Hochrechnung (Ende Tag ${detail.pace.daysInMonth})`,
                  value: formatEuro(detail.pace.projectedMonthSpend),
                },
                {
                  label: "Monatsziel",
                  value:
                    detail.pace.goalTargetEur != null
                      ? formatEuro(detail.pace.goalTargetEur)
                      : "Kein Ziel",
                },
                {
                  label: "Pace",
                  value:
                    detail.pace.pacePct != null
                      ? formatPercent(detail.pace.pacePct)
                      : "–",
                  tone:
                    detail.pace.pacePct == null
                      ? "neutral"
                      : detail.pace.pacePct > 1.1
                        ? "bad"
                        : detail.pace.pacePct < 0.85
                          ? "warn"
                          : "good",
                },
              ]}
            />
          )}

          {/* Per-platform cards */}
          <section className="grid gap-6 md:grid-cols-2">
            <PlatformCard
              platform="meta"
              data={live.find((l) => l.platform === "meta")}
              cred={metaCred}
              detail={detail?.platforms.meta}
            />
            <PlatformCard
              platform="google"
              data={live.find((l) => l.platform === "google")}
              cred={googleCred}
              detail={detail?.platforms.google}
            />
          </section>

          {detail?.campaigns && detail.campaigns.length > 0 && (
            <Card className="print:break-inside-avoid" style={CARD_SURFACE}>
              <CardHeader>
                <CardTitle className="!text-xl !font-medium md:!text-2xl">
                  Kampagnen-Übersicht
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  rows={detail.campaigns}
                  columns={[
                    {
                      key: "campaignName",
                      header: "Kampagne",
                      render: (r) => (
                        <span className="font-medium text-fg-primary">
                          {r.campaignName}
                        </span>
                      ),
                    },
                    {
                      key: "platform",
                      header: "Plattform",
                      render: (r) => r.platform,
                    },
                    {
                      key: "spendEur",
                      header: "Budget",
                      align: "right",
                      render: (r) => formatEuro(r.spendEur),
                    },
                    {
                      key: "impressions",
                      header: "Impressions",
                      align: "right",
                      render: (r) => formatNumber(r.impressions),
                    },
                    {
                      key: "clicks",
                      header: "Klicks",
                      align: "right",
                      render: (r) => formatNumber(r.clicks),
                    },
                    {
                      key: "ctr",
                      header: "CTR",
                      align: "right",
                      render: (r) => (r.ctr != null ? formatPercent(r.ctr) : "–"),
                    },
                    {
                      key: "leads",
                      header: "Anfragen",
                      align: "right",
                      render: (r) => formatNumber(r.leads),
                    },
                    {
                      key: "cplEur",
                      header: "CPL",
                      align: "right",
                      render: (r) => (r.cplEur != null ? formatEuro(r.cplEur) : "–"),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card className="print:break-inside-avoid" style={CARD_SURFACE}>
        <CardHeader>
          <CardTitle className="!text-xl !font-medium md:!text-2xl">
            Hinweise zur Messung
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-base text-fg-primary">
          <p>
            Die Zahlen werden täglich aus Meta und Google abgerufen. Kleine
            Abweichungen zu den dortigen Auswertungen sind normal, weil sich
            die Werbe-Zuordnung 24 bis 48 Stunden rückwirkend ändert.
          </p>
          <p>
            „Anfragen“ sind hier Formular-Einreichungen, die tatsächlich in
            Ihrem Posteingang gelandet sind, nicht nur Klicks.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

async function fetchDetail(clinicId: string, userId: string, days: number) {
  const [metaDaily, googleDaily, metaSync, googleSync, campaigns, pace] =
    await Promise.all([
      campaignDailyByPlatform(clinicId, userId, "meta", days),
      campaignDailyByPlatform(clinicId, userId, "google", days),
      syncHistory(clinicId, userId, "meta", 10),
      syncHistory(clinicId, userId, "google", 10),
      campaignsForPeriod(clinicId, userId, days),
      spendPaceProjection(clinicId, userId),
    ]);

  return {
    platforms: {
      meta: { daily: metaDaily, sync: metaSync },
      google: { daily: googleDaily, sync: googleSync },
    },
    campaigns,
    pace,
  };
}

type StatTone = "good" | "warn" | "bad" | "neutral";

const statToneClass: Record<StatTone, string> = {
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
  neutral: "text-fg-primary",
};

interface StatItem {
  label: string;
  value: string;
  /** Optional sub-line under the value, e.g. "letzte 30 Tage". */
  hint?: string;
  tone?: StatTone;
}

/**
 * A group of related numbers sharing ONE elevated card, separated by hairline
 * dividers on wide viewports and stacked with spacing on narrow ones. Replaces
 * the old "one bordered box per value" grid and mirrors the dashboard's
 * MetricTile / ForecastStrip surface so the two tabs read as one product.
 *
 * `size="lg"` is the three hero numbers (one row from `sm` up); the default
 * `md` is the four Pace numbers (2x2 on small, one row from `lg` up).
 */
function StatStrip({
  title,
  stats,
  size = "md",
}: {
  title?: string;
  stats: StatItem[];
  size?: "md" | "lg";
}) {
  const isHero = size === "lg";
  return (
    <section
      className="rounded-2xl border border-border p-6 md:p-8 print:break-inside-avoid"
      style={CARD_SURFACE}
    >
      {title && (
        <h2 className="mb-5 text-xl font-medium text-fg-primary md:text-2xl">
          {title}
        </h2>
      )}
      <dl
        className={cn(
          "grid gap-6",
          isHero
            ? "grid-cols-3 gap-3 sm:gap-0"
            : "grid-cols-2 lg:grid-cols-4 lg:gap-0"
        )}
      >
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={cn(
              "flex h-full flex-col",
              isHero
                ? "sm:px-6 sm:first:pl-0 sm:last:pr-0"
                : "lg:px-6 lg:first:pl-0 lg:last:pr-0",
              i > 0 &&
                (isHero
                  ? "sm:border-l sm:border-border"
                  : "lg:border-l lg:border-border")
            )}
          >
            <dt className="text-sm text-fg-secondary">{s.label}</dt>
            <dd
              className={cn(
                "mt-auto pt-1.5 font-display font-semibold tabular-nums",
                isHero ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl",
                statToneClass[s.tone ?? "neutral"]
              )}
            >
              {s.value}
            </dd>
            {s.hint && (
              <dd className="mt-1 text-xs text-fg-tertiary">{s.hint}</dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

function PlatformCard({
  platform,
  data,
  cred,
  detail,
}: {
  platform: "meta" | "google";
  data?: { spendEur: number; leads: number; cplEur: number | null };
  cred?: {
    accountId: string | null;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  };
  detail?: {
    daily: Array<{
      date: string;
      spendEur: number;
      leads: number;
      cplEur: number | null;
      impressions: number;
      clicks: number;
      ctr: number | null;
    }>;
    sync: Array<{ date: string; rowCount: number }>;
  };
}) {
  const connected = !!cred;
  return (
    <Card className="print:break-inside-avoid" style={CARD_SURFACE}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="!text-xl !font-medium md:!text-2xl">
            {PLATFORM_LABELS[platform]}
          </CardTitle>
          {connected ? (
            <Badge tone="good">Verbunden</Badge>
          ) : (
            <Badge tone="neutral">Nicht verbunden</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat
                label="Budget"
                value={formatEuro(data?.spendEur ?? 0)}
              />
              <MiniStat
                label="Anfragen"
                value={formatNumber(data?.leads ?? 0)}
              />
              <MiniStat
                label="Kosten/Anfrage"
                value={data?.cplEur != null ? formatEuro(data.cplEur) : "–"}
              />
            </div>

            {detail && detail.daily.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <MiniTrend
                    label="Budget pro Tag"
                    data={detail.daily.map((d) => ({ date: d.date, value: d.spendEur }))}
                    tone="accent"
                    valueFormat="euro"
                  />
                  <MiniTrend
                    label="Anfragen pro Tag"
                    data={detail.daily.map((d) => ({ date: d.date, value: d.leads }))}
                    tone="good"
                    valueFormat="number"
                  />
                  <MiniTrend
                    label="CPL pro Tag"
                    data={detail.daily.map((d) => ({ date: d.date, value: d.cplEur ?? 0 }))}
                    tone="warn"
                    valueFormat="euro"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <MiniStat
                    label="Impressionen"
                    value={formatNumber(
                      detail.daily.reduce((s, d) => s + d.impressions, 0)
                    )}
                  />
                  <MiniStat
                    label="Klicks"
                    value={formatNumber(
                      detail.daily.reduce((s, d) => s + d.clicks, 0)
                    )}
                  />
                  <MiniStat
                    label="CTR"
                    value={(() => {
                      const imp = detail.daily.reduce((s, d) => s + d.impressions, 0);
                      const clk = detail.daily.reduce((s, d) => s + d.clicks, 0);
                      return imp > 0 ? formatPercent(clk / imp) : "–";
                    })()}
                  />
                </div>

                <Accordion type="single" collapsible>
                  <AccordionItem value="sync">
                    <AccordionTrigger>Abgleich-Verlauf (letzte 10)</AccordionTrigger>
                    <AccordionContent>
                      {detail.sync.length === 0 ? (
                        <p className="text-sm text-fg-secondary">
                          Noch keine Abgleiche.
                        </p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs font-medium text-fg-secondary">
                            <tr>
                              <th className="px-3 py-1.5">Datum</th>
                              <th className="px-3 py-1.5 text-right">Datensätze</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {detail.sync.map((s) => (
                              <tr key={s.date}>
                                <td className="px-3 py-1.5 tabular-nums">{s.date}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">
                                  {formatNumber(s.rowCount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </>
            )}

            {cred?.lastSyncError && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">Synchronisierung fehlgeschlagen</div>
                  <div className="mt-1 text-fg-primary">{cred.lastSyncError}</div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-fg-secondary">
              <span>Konto-ID: {cred?.accountId ?? "—"}</span>
              <span>
                Letzter Abgleich:{" "}
                {cred?.lastSyncedAt ? formatRelative(cred.lastSyncedAt) : "noch nie"}
              </span>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-fg-primary">
              Verbinden Sie das {PLATFORM_LABELS[platform]}-Konto, damit wir Ihr
              Budget hier live anzeigen können.
            </p>
            <Button asChild variant="outline">
              <Link href={`/einstellungen/integrationen?connect=${platform}`}>
                <LinkIcon className="h-4 w-4" />
                {PLATFORM_LABELS[platform]} verbinden
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-fg-secondary">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function MiniTrend({
  label,
  data,
  tone,
  valueFormat,
}: {
  label: string;
  data: { date: string; value: number }[];
  tone: TrendChartTone;
  valueFormat?: TrendChartValueFormat;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-fg-secondary">{label}</div>
      <TrendChart
        data={data}
        tone={tone}
        label={label}
        valueFormat={valueFormat}
      />
    </div>
  );
}
