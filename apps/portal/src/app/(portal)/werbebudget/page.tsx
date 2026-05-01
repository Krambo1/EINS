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
  Sparkline,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
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
import { DataTable } from "../auswertung/_components/detail-helpers";

export const metadata = { title: "Werbebudget Live" };

type Search = { days?: string };

const PLATFORM_LABELS = {
  meta: "Meta · Facebook & Instagram",
  google: "Google Ads",
} as const;

export default async function WerbebudgetPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePermissionOrRedirect("campaigns.live");
  const params = await searchParams;
  const days = Math.max(7, Math.min(90, Number(params.days ?? 30)));
  const isDetail = session.uiMode === "detail";

  const [live, creds] = await Promise.all([
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
  ]);

  // Detail bundle in parallel.
  const detail = isDetail
    ? await fetchDetail(session.clinicId, session.userId, days)
    : null;

  const totalSpend = live.reduce((sum, r) => sum + r.spendEur, 0);
  const totalLeads = live.reduce((sum, r) => sum + r.leads, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : null;

  const metaCred = creds.find((c) => c.platform === "meta");
  const googleCred = creds.find((c) => c.platform === "google");

  const noIntegrations = !metaCred && !googleCred;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Werbebudget Live.</h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            Was Sie investiert haben und was dabei herauskommt. Aktuelle Zahlen
            direkt aus Meta und Google.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/werbebudget?days=${d}`}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                days === d
                  ? "border-accent bg-accent/15 text-fg-primary"
                  : "border-border text-fg-secondary hover:bg-bg-secondary"
              }`}
            >
              {d} Tage
            </Link>
          ))}
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
          <section className="grid gap-4 md:grid-cols-3">
            <SummaryBox
              label="Budget in letzten"
              sub={`${days} Tagen`}
              value={formatEuro(totalSpend)}
            />
            <SummaryBox
              label="Anfragen über Werbung"
              sub="aus beiden Plattformen"
              value={formatNumber(totalLeads)}
            />
            <SummaryBox
              label="Ø Kosten je Anfrage"
              sub="über alle Plattformen"
              value={avgCpl !== null ? formatEuro(avgCpl) : "–"}
            />
          </section>

          {/* Detail-only pace projection card */}
          {isDetail && detail?.pace && (
            <Card className="print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Monats-Hochrechnung (Pace)</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-4">
                <PaceStat
                  label="Bisher diesen Monat"
                  value={formatEuro(detail.pace.monthSpendSoFar)}
                />
                <PaceStat
                  label={`Hochrechnung (Ende Tag ${detail.pace.daysInMonth})`}
                  value={formatEuro(detail.pace.projectedMonthSpend)}
                />
                <PaceStat
                  label="Monatsziel"
                  value={
                    detail.pace.goalTargetEur != null
                      ? formatEuro(detail.pace.goalTargetEur)
                      : "Kein Ziel"
                  }
                />
                <PaceStat
                  label="Pace"
                  value={
                    detail.pace.pacePct != null
                      ? formatPercent(detail.pace.pacePct)
                      : "–"
                  }
                  tone={
                    detail.pace.pacePct == null
                      ? "neutral"
                      : detail.pace.pacePct > 1.1
                      ? "bad"
                      : detail.pace.pacePct < 0.85
                      ? "warn"
                      : "good"
                  }
                />
              </CardContent>
            </Card>
          )}

          {/* Per-platform cards */}
          <section className="grid gap-6 md:grid-cols-2">
            <PlatformCard
              platform="meta"
              data={live.find((l) => l.platform === "meta")}
              cred={metaCred}
              isDetail={isDetail}
              detail={detail?.platforms.meta}
            />
            <PlatformCard
              platform="google"
              data={live.find((l) => l.platform === "google")}
              cred={googleCred}
              isDetail={isDetail}
              detail={detail?.platforms.google}
            />
          </section>

          {isDetail && detail?.campaigns && detail.campaigns.length > 0 && (
            <Card className="print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Kampagnen-Übersicht</CardTitle>
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

      {isDetail && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Hinweise zur Messung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-base text-fg-primary">
            <p>
              Die Zahlen werden täglich aus Meta und Google abgerufen. Kleine
              Abweichungen zu den dortigen Dashboards sind normal, weil Werbe-
              attribution sich 24 bis 48 Stunden rückwirkend ändert.
            </p>
            <p>
              „Anfragen“ sind hier Formular-Einreichungen, die tatsächlich in
              Ihrem Posteingang gelandet sind, nicht nur Klicks.
            </p>
          </CardContent>
        </Card>
      )}
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

function SummaryBox({
  label,
  sub,
  value,
}: {
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/40 p-6">
      <div className="text-sm font-medium text-fg-secondary">
        {label} {sub && <span className="text-fg-secondary">{sub}</span>}
      </div>
      <div className="mt-2 font-display text-4xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function PaceStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass: Record<typeof tone, string> = {
    good: "text-tone-good",
    warn: "text-tone-warn",
    bad: "text-tone-bad",
    neutral: "text-fg-primary",
  };
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-semibold tabular-nums ${toneClass[tone]}`}>
        {value}
      </div>
    </div>
  );
}

function PlatformCard({
  platform,
  data,
  cred,
  isDetail,
  detail,
}: {
  platform: "meta" | "google";
  data?: { spendEur: number; leads: number; cplEur: number | null };
  cred?: {
    accountId: string | null;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  };
  isDetail: boolean;
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
    <Card className="print:break-inside-avoid">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{PLATFORM_LABELS[platform]}</CardTitle>
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

            {/* Detail-only: per-platform charts + extra columns */}
            {isDetail && detail && detail.daily.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <MiniSparkline
                    label="Budget pro Tag"
                    values={detail.daily.map((d) => d.spendEur)}
                    tone="accent"
                  />
                  <MiniSparkline
                    label="Anfragen pro Tag"
                    values={detail.daily.map((d) => d.leads)}
                    tone="good"
                  />
                  <MiniSparkline
                    label="CPL pro Tag"
                    values={detail.daily.map((d) => d.cplEur ?? 0)}
                    tone="warn"
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
                    <AccordionTrigger>Sync-Verlauf (letzte 10)</AccordionTrigger>
                    <AccordionContent>
                      {detail.sync.length === 0 ? (
                        <p className="text-sm text-fg-secondary">
                          Noch keine Sync-Vorgänge.
                        </p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs uppercase tracking-wide text-fg-secondary">
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
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function MiniSparkline({
  label,
  values,
  tone,
}: {
  label: string;
  values: number[];
  tone: "accent" | "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <Sparkline values={values} tone={tone} height={36} />
    </div>
  );
}
