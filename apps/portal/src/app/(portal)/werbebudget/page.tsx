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
  cn,
} from "@eins/ui";
import { campaignLiveSummaryTx } from "@/server/queries/kpis";
import {
  adInquiriesByDayTx,
  type AdInquiryDay,
  campaignDailyByPlatformTx,
  campaignsForPeriodTx,
  syncHistoryTx,
  spendPaceProjectionTx,
} from "@/server/queries/campaigns";
import { db, schema, withClinicContext } from "@/db/client";
import {
  formatEuro,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/formatting";
import { AlertTriangle, ChevronDown, Info, Link as LinkIcon, Plug } from "lucide-react";
import { META_PAGE_ERRORS, metaPageErrorText } from "@/server/meta-pages";
import { DataTable } from "../dashboard/_components/detail-helpers";
import { Brand } from "@/app/_components/Brand";
import { ChapterLaunchLink } from "@/app/(portal)/_components/tour/ChapterLaunchLink";

export const metadata = { title: "Werbebudget" };

type Search = { days?: string | string[] };

const DAY_OPTIONS = [7, 30, 90] as const;

/** `?days=` hardened: only the three offered windows, anything else is 30. */
function parseDays(raw: Search["days"]): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (DAY_OPTIONS as readonly number[]).includes(n) ? n : 30;
}

/** North-star wording for the organic start (no numbers, no promises). */
const ORGANIC_START_NOTE =
  "Ihre Beiträge laufen zuerst organisch. Sobald sichtbar ist, welche Beiträge Anfragen bringen, schlägt EINS Ihnen vor, wie viel Werbebudget dahinter gehen soll. Diese Seite füllt sich, sobald bezahlte Anzeigen laufen.";

const CAMPAIGN_PLATFORM_LABELS: Record<string, string> = { meta: "Meta", google: "Google" };

const PLATFORM_LABELS: Record<"meta" | "google", React.ReactNode> = {
  meta: <Brand brand="meta">Meta</Brand>,
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
  const days = parseDays(params.days);
  const isInhaber = session.role === "inhaber";

  // Credentials first (one statement): a Praxis without Meta/Google (the
  // organic start) renders the empty state without running any of the
  // campaign queries. With integrations, all campaign reads run in ONE
  // transaction instead of seven.
  const creds = await db
    .select({
      platform: schema.platformCredentials.platform,
      accountId: schema.platformCredentials.accountId,
      lastSyncedAt: schema.platformCredentials.lastSyncedAt,
      lastSyncError: schema.platformCredentials.lastSyncError,
    })
    .from(schema.platformCredentials)
    .where(eq(schema.platformCredentials.clinicId, session.clinicId));
  const { live, detail } =
    creds.length > 0
      ? await fetchWerbebudget(session.clinicId, session.userId, days)
      : { live: [], detail: null };

  const totalSpend = live.reduce((sum, r) => sum + r.spendEur, 0);
  const totalLeads = live.reduce((sum, r) => sum + r.leads, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : null;

  const metaCred = creds.find((c) => c.platform === "meta");
  const googleCred = creds.find((c) => c.platform === "google");

  const noIntegrations = !metaCred && !googleCred;

  return (
    <div className="space-y-10">
      <header
        data-tour="werbebudget-header"
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Werbebudget.</h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            Was Sie investiert haben und was dabei herauskommt. Das
            Werbebudget kommt direkt aus Meta und Google, die Anfragen aus
            Ihrem Portal.
          </p>
          {isInhaber && (
            <div className="mt-3">
              <ChapterLaunchLink chapter="werbebudget" />
            </div>
          )}
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
                    : "text-fg-primary hover:bg-bg-tertiary"
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
          title="Noch keine bezahlten Anzeigen"
          description={ORGANIC_START_NOTE}
          action={
            <Button asChild variant="outline">
              <Link href="/einstellungen/integrationen">
                <LinkIcon className="h-4 w-4" />
                Werbekonten verbinden
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {totalSpend === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-bg-secondary px-5 py-4 md:px-6">
              <p className="text-base font-medium text-fg-primary">
                Noch keine bezahlten Anzeigen in diesem Zeitraum.
              </p>
              <p className="mt-1 text-base text-fg-primary">
                {ORGANIC_START_NOTE}
              </p>
            </div>
          )}
          <StatStrip
            size="lg"
            title="Insgesamt"
            dataTour="werbebudget-totals"
            stats={[
              {
                label: "Werbebudget",
                value: formatEuro(totalSpend),
              },
              {
                label: "Anfragen über Werbung",
                value: formatNumber(totalLeads),
              },
              {
                label: "Kosten pro Anfrage",
                value: avgCpl !== null ? formatEuro(avgCpl) : "",
              },
            ]}
          />

          {detail?.pace && (
            <StatStrip
              title="Hochrechnung für diesen Monat"
              stats={[
                {
                  label: "Bisher ausgegeben",
                  value: formatEuro(detail.pace.monthSpendSoFar),
                },
                {
                  label: "Hochrechnung Monatsende",
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
                  label: "Anteil am Monatsziel",
                  value:
                    detail.pace.pacePct != null
                      ? formatPercent(detail.pace.pacePct)
                      : "",
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
          <section data-tour="werbebudget-platforms" className="grid gap-6 md:grid-cols-2">
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
                  fitPhone
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
                    // Phone (< md): Kampagne, Werbebudget, Anfragen, Kosten pro
                    // Anfrage. Impressionen and Klicks stay in the platform
                    // cards above, so this table fits the card without scrolling.
                    {
                      key: "platform",
                      header: "Plattform",
                      hideBelowMd: true,
                      render: (r) => CAMPAIGN_PLATFORM_LABELS[r.platform] ?? r.platform,
                    },
                    {
                      key: "spendEur",
                      header: <>Werbe&shy;budget</>,
                      align: "right",
                      render: (r) => formatEuro(r.spendEur),
                    },
                    {
                      key: "ctr",
                      header: "Klickrate",
                      align: "right",
                      hideBelowMd: true,
                      render: (r) => (r.ctr != null ? formatPercent(r.ctr) : ""),
                    },
                    {
                      key: "leads",
                      header: "Anfragen",
                      align: "right",
                      render: (r) => (r.leads != null ? formatNumber(r.leads) : ""),
                    },
                    {
                      key: "cplEur",
                      header: "Kosten pro Anfrage",
                      align: "right",
                      render: (r) => (r.cplEur != null ? formatEuro(r.cplEur) : ""),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card
        data-tour="werbebudget-method"
        className="print:break-inside-avoid"
        style={CARD_SURFACE}
      >
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
            „Anfragen“ sind Anfragen über eine Meta- oder Google-Anzeige, die
            in Ihrem Portal angekommen sind, gezählt wie auf der Übersicht.
            Meta und Google zeigen in ihren eigenen Auswertungen oft eine
            andere Zahl.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

async function fetchWerbebudget(clinicId: string, userId: string, days: number) {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [live, metaDaily, googleDaily, metaSync, googleSync, campaigns, pace, adInquiries] =
        await Promise.all([
          campaignLiveSummaryTx(tx, clinicId, days),
          campaignDailyByPlatformTx(tx, clinicId, "meta", days),
          campaignDailyByPlatformTx(tx, clinicId, "google", days),
          syncHistoryTx(tx, clinicId, "meta", 10),
          syncHistoryTx(tx, clinicId, "google", 10),
          campaignsForPeriodTx(tx, clinicId, days),
          spendPaceProjectionTx(tx, clinicId),
          adInquiriesByDayTx(tx, clinicId, days),
        ]);
      return {
        live: withPortalInquiries(live, adInquiries),
        detail: {
          platforms: {
            meta: { daily: withPortalInquiries(metaDaily, adInquiries, "meta"), sync: metaSync },
            google: { daily: withPortalInquiries(googleDaily, adInquiries, "google"), sync: googleSync },
          },
          campaigns,
          pace,
        },
      };
    },
    "werbebudget:bundle"
  );
}

/**
 * Swap the lead count the platforms report for the Anfragen that reached the
 * portal (adInquiriesByDayTx), and recompute the cost per Anfrage from it.
 * Totals rows carry a `platform`; daily rows of one platform carry a `date`.
 */
function withPortalInquiries<
  T extends { spendEur: number; leads: number; cplEur: number | null; platform?: string; date?: string },
>(rows: T[], inquiries: AdInquiryDay[], platform?: "meta" | "google"): T[] {
  return rows.map((r) => {
    const p = platform ?? r.platform;
    const leads = inquiries
      .filter((i) => i.platform === p && (r.date === undefined || i.date === r.date))
      .reduce((sum, i) => sum + i.inquiries, 0);
    return {
      ...r,
      leads,
      cplEur: leads > 0 ? Number((r.spendEur / leads).toFixed(2)) : null,
    };
  });
}

/**
 * Meta is connected but several Facebook pages are administered and none is
 * chosen yet. last_sync_error then holds the German text from
 * `metaPageErrorText` (or, from older writes, the raw code).
 */
const PAGE_SELECTION_PENDING = new Set<string>([
  META_PAGE_ERRORS.multiplePages,
  metaPageErrorText(new Error(META_PAGE_ERRORS.multiplePages)),
]);

function isPageSelectionPending(lastSyncError: string): boolean {
  return PAGE_SELECTION_PENDING.has(lastSyncError.trim());
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
  dataTour,
}: {
  title?: string;
  stats: StatItem[];
  size?: "md" | "lg";
  /** Optional `data-tour` anchor for the product-tour spotlight. */
  dataTour?: string;
}) {
  const isHero = size === "lg";
  return (
    <section
      data-tour={dataTour}
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
            ? "grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-0"
            : "grid-cols-1 gap-5 min-[420px]:grid-cols-2 lg:grid-cols-4 lg:gap-0"
        )}
      >
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={cn(
              "flex h-full min-w-0 flex-col",
              isHero
                ? "sm:px-6 sm:first:pl-0 sm:last:pr-0"
                : "lg:px-6 lg:first:pl-0 lg:last:pr-0",
              i > 0 &&
                (isHero
                  ? "sm:border-l sm:border-border"
                  : "lg:border-l lg:border-border")
            )}
          >
            <dt className="text-sm font-medium text-fg-primary md:text-base">{s.label}</dt>
            <dd
              className={cn(
                "mt-auto whitespace-nowrap pt-1.5 font-display font-semibold tabular-nums",
                isHero
                  ? "text-3xl sm:text-2xl md:text-3xl lg:text-4xl"
                  : "text-2xl lg:text-3xl",
                statToneClass[s.tone ?? "neutral"]
              )}
            >
              {s.value}
            </dd>
            {s.hint && (
              <dd className="mt-1 text-sm text-fg-secondary">{s.hint}</dd>
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
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
          <CardTitle className="!text-xl !font-medium md:!text-2xl">
            {PLATFORM_LABELS[platform]}
          </CardTitle>
          {connected ? (
            <Badge tone="good" className="text-fg-primary">Verbunden</Badge>
          ) : (
            <Badge tone="neutral">Nicht verbunden</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3 min-[420px]:gap-3">
              <MiniStat
                label="Werbebudget"
                value={formatEuro(data?.spendEur ?? 0)}
              />
              <MiniStat
                label="Anfragen"
                value={formatNumber(data?.leads ?? 0)}
              />
              <MiniStat
                label="Kosten pro Anfrage"
                value={data?.cplEur != null ? formatEuro(data.cplEur) : ""}
              />
            </div>

            {detail && detail.daily.length > 0 && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-3">
                  <MiniTrend
                    label="Werbebudget pro Tag"
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
                    label="Kosten pro Anfrage je Tag"
                    data={detail.daily.map((d) => ({ date: d.date, value: d.cplEur ?? 0 }))}
                    tone="warn"
                    valueFormat="euro"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3 min-[420px]:gap-3">
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
                    label="Klickrate"
                    value={(() => {
                      const imp = detail.daily.reduce((s, d) => s + d.impressions, 0);
                      const clk = detail.daily.reduce((s, d) => s + d.clicks, 0);
                      return imp > 0 ? formatPercent(clk / imp) : "";
                    })()}
                  />
                </div>

                {/* Native <details>: Radix Accordion ids drift between server
                    and client here (hydration mismatch). */}
                <details className="group border-b border-border">
                  <summary className="opa-focus-ring flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-medium [&::-webkit-details-marker]:hidden">
                    Abgleich-Verlauf (letzte 10)
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-fg-secondary transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <div className="pb-4">
                      {detail.sync.length === 0 ? (
                        <p className="text-base text-fg-primary">
                          Noch keine Abgleiche.
                        </p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-left text-sm font-medium text-fg-primary">
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
                  </div>
                </details>
              </>
            )}

            {cred?.lastSyncError &&
              (isPageSelectionPending(cred.lastSyncError) ? (
                // Not a failure: Meta is connected, the Praxis still has to
                // pick which of several Facebook pages is hers.
                <div className="flex items-start gap-2 rounded-md border border-border bg-bg-secondary p-3 text-sm text-fg-primary">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-fg-primary" aria-hidden />
                  <div>
                    <div className="font-semibold">Facebook-Seite auswählen</div>
                    <p className="mt-1">
                      Ihr Facebook-Konto verwaltet mehrere Seiten. Bitte wählen Sie
                      die Seite Ihrer Praxis, damit Anfragen aus Meta-Formularen in
                      Ihrem Portal ankommen.
                    </p>
                    <Link
                      href="/einstellungen/integrationen/meta-seite"
                      className="mt-2 inline-flex items-center gap-1 font-medium text-fg-primary underline underline-offset-4"
                    >
                      Facebook-Seite auswählen
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-fg-primary">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tone-bad" aria-hidden />
                  <div>
                    <div className="font-semibold">Synchronisierung fehlgeschlagen</div>
                    <div className="mt-1">{cred.lastSyncError}</div>
                  </div>
                </div>
              ))}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-fg-primary">
              {cred?.accountId ? <span>Konto-ID: {cred.accountId}</span> : <span />}
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
              Werbebudget hier laufend anzeigen können.
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
    <div className="flex h-full flex-col justify-between">
      <div className="text-sm font-medium text-fg-primary">{label}</div>
      <div className="mt-1 whitespace-nowrap font-display text-xl font-semibold tabular-nums">
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
    <div className="flex h-full flex-col justify-between">
      <div className="text-sm font-medium text-fg-primary">{label}</div>
      <TrendChart
        data={data}
        tone={tone}
        label={label}
        valueFormat={valueFormat}
      />
    </div>
  );
}
