import type { ReactNode } from "react";
import Link from "next/link";
import {
  Button,
  TrendChart,
  cn,
  type TrendChartPoint,
  type TrendChartValueFormat,
} from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { Link as LinkIcon, Settings2 } from "lucide-react";
import { BrandLogo } from "@/app/_components/Brand";
import { formatEuro, formatNumber, formatRelative } from "@/lib/formatting";
import {
  CARD_TITLE,
  CONTROL,
  DashCard,
  RAISED_CONTROL,
  RollingNumber,
  TABLE_HEAD_BAND,
  TABLE_ROW,
} from "../../dashboard/_components/dash-ui";
import { barSize, stepDelays } from "../../dashboard/_components/DashboardDetailBundle";
import { ChartFloor } from "../../dashboard/_components/hover-card";
import {
  WB_ACTION_WIDTH,
  WB_CAMPAIGN_COLUMNS,
  WB_CAMPAIGN_LIST_HEIGHT,
  WB_PLATFORM_COLUMNS,
} from "../_lib/werbebudget";

/**
 * The parts of /werbebudget. Every part also draws its own skeleton (no data),
 * so `loading.tsx` has the page's sizes by construction.
 */

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";

/** The Übersicht's Kennzahl lines (KpiTiles.tsx): straight, 2 px, mint. */
const LINE_STYLE = {
  curve: "straight",
  strokeWidth: 2,
  lineGradient: { top: "var(--line-top)", bottom: "var(--line-bottom)" },
  tooltip: "compact",
} as const;

export type Platform = "meta" | "google";

export const PLATFORM_NAMES: Record<Platform, string> = { meta: "Meta", google: "Google Ads" };

/* ------------------------------------------------------------------ */
/* First row                                                            */
/* ------------------------------------------------------------------ */

/**
 * The page's one action at the right end of its first row (DESIGN.md §3):
 * "Werbekonten verbinden" while nothing is connected, "Werbekonten verwalten"
 * after, both to the Werbekonten card in Einstellungen. Same width in both,
 * so it never moves. `connected === null` draws the skeleton. A role that may
 * not connect accounts (Inhaber only) gets an empty box of the same size.
 */
export function WerbekontenAction({
  connected,
  canConnect = true,
  className,
}: {
  connected: boolean | null;
  canConnect?: boolean;
  className?: string;
}) {
  if (connected === null || !canConnect) {
    return (
      <div
        aria-hidden
        className={cn(
          "shrink-0",
          connected === null ? "elev-raised bg-[var(--surface-raised)]" : "invisible",
          CONTROL,
          WB_ACTION_WIDTH,
          className
        )}
      />
    );
  }
  return (
    <Button
      asChild
      size="sm"
      variant={connected ? "outline" : "default"}
      className={cn(CONTROL, WB_ACTION_WIDTH, "shrink-0 px-3", connected && RAISED_CONTROL, className)}
    >
      {/* Plain <a>: Einstellungen streams in behind its skeleton, so a
          client navigation finds no #werbekonten yet and stays at the top. */}
      <a href="/einstellungen#werbekonten">
        {connected ? (
          <Settings2 className="h-4 w-4" aria-hidden />
        ) : (
          <LinkIcon className="h-4 w-4" aria-hidden />
        )}
        <span className="sm:hidden">{connected ? "Werbekonten" : "Verbinden"}</span>
        <span className="hidden sm:inline">
          {connected ? "Werbekonten verwalten" : "Werbekonten verbinden"}
        </span>
      </a>
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Kennzahlen                                                         */
/* ------------------------------------------------------------------ */

/**
 * Skeleton of the primary Kennzahl: KpiTile's primary panel part for part
 * (label row, 40/48 px number, the 216 px plot area), so it has its height.
 */
export function PrimaryFigureSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--surface-tile)] px-5 py-5 md:p-6">
      <div className="min-w-0 flex-1 md:flex-none">
        <div className="flex h-5 items-center">
          <span className={CARD_TITLE}>Werbebudget</span>
        </div>
        {/* RollingNumber's line box: 1.5 times the 40 / 48 px figure. */}
        <div className="mt-1 flex h-[3.75rem] items-center md:h-[4.5rem]">
          <span className={cn(BAR, "h-8 w-40 md:h-10")} />
        </div>
      </div>
      <div className="relative mt-auto h-[216px] pt-5">
        <div className="relative h-[180px]">
          <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
            <span className="border-t border-dashed border-border" />
            <span className="border-t border-dashed border-border" />
            <span />
          </div>
          <ChartFloor />
        </div>
      </div>
    </div>
  );
}

/**
 * One cell of the Kennzahlen block, KpiTile's anatomy (KpiTiles.tsx): a row
 * on the phone (label and number left, line right), stacked from md. Unlike
 * KpiTile it can stand without a figure ("Keine qualifizierte Anfrage" in
 * the number's place, same height), and it draws its own skeleton.
 */
export function FigureCell({
  label,
  shortLabel,
  narrowLabel,
  labelExtra,
  value,
  missing,
  series,
  valueFormat = "number",
  skeleton = false,
}: {
  label: string;
  /** Shorter label while the cell is narrower than 12rem (`.kpi-tile`). */
  shortLabel?: string;
  /**
   * Shorter label while the label row (with its info icon) is narrower than
   * 13.5rem. The row's own width decides, so it works for the phone's row
   * and the stacked cell alike; a label is never cut.
   */
  narrowLabel?: string;
  labelExtra?: ReactNode;
  /** null: no figure, `missing` stands in its place. */
  value?: string | null;
  missing?: string;
  series?: TrendChartPoint[];
  valueFormat?: TrendChartValueFormat;
  skeleton?: boolean;
}) {
  // A line only where it says something: two points or more, not all 0.
  const hasLine = !skeleton && !!series && series.length > 1 && series.some((p) => p.value !== 0);
  const chartKey = hasLine ? `${series!.length}-${series![0]!.date}` : "none";
  return (
    <div
      className={cn(
        "relative flex min-w-0 items-center gap-4 bg-[var(--surface-tile)] px-5 py-4 md:flex-col md:items-stretch md:gap-0 md:p-6",
        shortLabel && "kpi-tile"
      )}
    >
      <div className="min-w-0 flex-1 md:flex-none">
        <div className={cn("flex h-5 min-w-0 items-center gap-1", narrowLabel && "[container-type:inline-size]")}>
          <span className={cn("truncate", CARD_TITLE)}>
            {narrowLabel ? (
              <>
                <span className="hidden [@container(min-width:13.5rem)]:inline">{label}</span>
                <span className="[@container(min-width:13.5rem)]:hidden">{narrowLabel}</span>
              </>
            ) : shortLabel ? (
              <>
                <span className="kpi-label-full">{label}</span>
                <span className="kpi-label-short">{shortLabel}</span>
              </>
            ) : (
              label
            )}
          </span>
          {labelExtra && !skeleton && <span className="relative z-10 inline-flex">{labelExtra}</span>}
        </div>
        <div className="mt-1 flex h-7 items-end md:h-8">
          {skeleton ? (
            <span className={cn(BAR, "h-6 w-24 md:h-7")} />
          ) : value != null ? (
            <RollingNumber
              value={value}
              className="font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-fg-primary md:text-[2rem]"
            />
          ) : (
            <span className="text-[15px] leading-5 text-fg-secondary">{missing}</span>
          )}
        </div>
      </div>
      {/* Fixed box for the line (40 px, 56 px with its top padding from md);
          without one it holds a flat line, like KpiTile. */}
      <div key={chartKey} className="relative z-10 h-10 w-20 shrink-0 md:mt-auto md:h-14 md:w-auto md:pt-4">
        {hasLine ? (
          <div className="anim-wipe">
            <TrendChart
              data={series!}
              tone="accent"
              label={label}
              valueFormat={valueFormat}
              height={40}
              filled={false}
              {...LINE_STYLE}
            />
          </div>
        ) : (
          <div aria-hidden className="flex h-10 items-end">
            <span className="block h-0.5 w-full rounded-full bg-[var(--border-hover)]" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What became of the Anfragen über Werbung, across the whole block. HubSpot's
 * ads funnel: the steps side by side, the share of the step before beside
 * each count, the Werbebudget per step under it ("$91.74 each"). The bars are
 * the Trichter's (Attio's funnel steps): a solid bar sized against the first
 * step, the step before as a pressed-in tint behind it. It follows the period
 * like the other cells. The three steps keep their columns on the phone; the
 * line under a bar shortens by the room its column has, never by cutting.
 */
export function AdFunnelCell({
  leads,
  qualified,
  appointments,
  won,
  spend,
  skeleton = false,
}: {
  /** Anfragen über Werbung, spam excluded. */
  leads: number;
  qualified: number;
  /** Of those, the ones with a Termin or further (the Trichter's Termine). */
  appointments: number;
  won: number;
  spend: number;
  skeleton?: boolean;
}) {
  const perStep = (count: number, unit: string) => {
    if (spend <= 0 || count <= 0) return null;
    const euro = formatEuro(spend / count);
    return { full: `${euro} pro ${unit}`, short: `je ${euro}` };
  };
  const steps = [
    {
      label: "Anfragen",
      value: leads,
      prev: null,
      prevLabel: "",
      // The qualifizierte: the unit of the cost tile above.
      line: leads > 0 ? { full: `${formatNumber(qualified)} qualifiziert`, short: `${formatNumber(qualified)} qualifiziert` } : null,
    },
    { label: "Termine", value: appointments, prev: leads, prevLabel: "der Anfragen", line: perStep(appointments, "Termin") },
    { label: "Gewonnen", value: won, prev: appointments, prevLabel: "der Termine", line: perStep(won, "Behandlung") },
  ];
  return (
    <div className="relative flex min-w-0 bg-[var(--surface-tile)] px-5 py-4 md:col-span-2 md:p-6">
      <ol aria-label="Ergebnis der Werbung" className="grid min-w-0 flex-1 grid-cols-3 gap-3 md:gap-6">
        {steps.map((s, i) => {
          // Where the tint shows past the bar, the bar ends square against it.
          const cut = s.prev != null && s.value < s.prev;
          const delay = stepDelays(i);
          return (
            <li key={s.label} className="flex min-w-0 flex-col [container-type:inline-size]">
              <div className="flex h-5 min-w-0 items-center gap-1">
                <span className={cn("whitespace-nowrap", CARD_TITLE)}>{s.label}</span>
                {i === 0 && !skeleton && (
                  <span className="relative z-10 inline-flex">
                    <ExplainerPopover term="Ergebnis der Werbung">
                      <p>
                        Was aus den Anfragen über Werbung im Zeitraum wurde: wie
                        viele einen Termin bekamen und wie viele als Behandlung
                        gewonnen wurden. Die Prozentzahl ist der Anteil an der
                        Stufe davor, der Betrag das Werbebudget geteilt durch die
                        Termine oder die Behandlungen. Gezählt wie im Trichter der
                        Übersicht.
                      </p>
                    </ExplainerPopover>
                  </span>
                )}
              </div>
              <div className="mb-3 mt-1 flex h-7 items-end gap-1.5 md:mb-4 md:h-8">
                {skeleton ? (
                  <span className={cn(BAR, "h-6 w-10 md:h-7")} />
                ) : (
                  <>
                    <RollingNumber
                      value={formatNumber(s.value)}
                      className="font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-fg-primary md:text-[2rem]"
                    />
                    {s.prev != null && s.prev > 0 && s.value > 0 && (
                      <span className="whitespace-nowrap text-sm font-medium leading-5 tabular-nums text-fg-secondary">
                        {Math.round((s.value / s.prev) * 100)} %<span className="sr-only"> {s.prevLabel}</span>
                      </span>
                    )}
                  </>
                )}
              </div>
              <div aria-hidden className="relative mt-auto h-2 shrink-0">
                {!skeleton && s.prev != null && s.prev > 0 && (
                  <div
                    className="bar-ghost anim-ghost absolute inset-y-0 left-0 rounded-[var(--r-mark)]"
                    style={{ width: barSize(s.prev, leads), ...delay.ghost }}
                  />
                )}
                {!skeleton && (
                  <div
                    className={cn("bar-solid anim-bar-x absolute inset-y-0 left-0", cut ? "rounded-l-[var(--r-mark)]" : "rounded-[var(--r-mark)]")}
                    style={{ width: barSize(s.value, leads), ...delay.bar }}
                  />
                )}
              </div>
              <p className="mt-2 flex h-5 items-center whitespace-nowrap text-sm leading-5 tabular-nums">
                {skeleton ? (
                  <span className={cn(BAR, "h-3.5 w-14")} />
                ) : s.line ? (
                  <span className="text-fg-secondary">
                    <span className="hidden [@container(min-width:8rem)]:inline">{s.line.full}</span>
                    <span className="[@container(min-width:8rem)]:hidden">{s.line.short}</span>
                  </span>
                ) : (
                  <span className="text-fg-tertiary">–</span>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Plattformen                                                          */
/* ------------------------------------------------------------------ */

export type PlatformState = "missing" | "ok" | "page" | "error";

export interface PlatformView {
  platform: Platform;
  state: PlatformState;
  lastSyncedAt: Date | null;
  /** The sync error as stored (German text), shown unchanged. */
  error: string | null;
  spendEur: number;
  leads: number;
  /** Werbebudget ÷ qualifizierte Anfragen, as on the Übersicht. */
  cplEur: number | null;
  /** May connect accounts (settings.integrations, Inhaber only); else no action. */
  canConnect: boolean;
}

/**
 * Meta and Google Ads as two rows of one table (Stripe's connected accounts,
 * Triple Whale's channel rows): logo and name with the row's own action
 * (connect, choose the Facebook page, connect again) on one line, the status
 * under it, the three figures in the Kampagnen table's columns, so both
 * tables share one grid. Below xl each platform is a block of the same
 * parts. Both rows always stand, connected or not, so the card has one
 * height in every state. `rows === null` draws the skeleton.
 */
export function PlatformsCard({ rows }: { rows: PlatformView[] | null }) {
  const list: Array<PlatformView | null> = rows ?? [null, null];
  return (
    <DashCard title="Plattformen" className="[--delay:60ms]">
      <div className="-mx-2">
        <div
          aria-hidden
          className={cn("mb-1 hidden items-center gap-x-4 px-2 xl:grid", TABLE_HEAD_BAND, WB_PLATFORM_COLUMNS)}
        >
          <span>Plattform</span>
          <span className="text-right">Werbebudget</span>
          <span className="text-right">Anfragen</span>
          <span className="text-right">Pro qualifizierte Anfrage</span>
        </div>
        <ul className="divide-y divide-border">
          {list.map((r, i) => (
            <PlatformRow key={r?.platform ?? i} row={r} />
          ))}
        </ul>
      </div>
    </DashCard>
  );
}

function PlatformRow({ row }: { row: PlatformView | null }) {
  const action = row && <PlatformAction row={row} />;
  // A platform that was never connected has no figures ("–"). One that was
  // disconnected keeps what it spent in the period, so the rows still add up
  // to the Werbebudget above.
  const off = !row || (row.state === "missing" && row.spendEur === 0 && row.leads === 0);
  return (
    <li className={cn("grid gap-x-4 px-2 py-4 xl:py-3", WB_PLATFORM_COLUMNS)}>
      <div className="min-w-0">
        <div className="flex h-[var(--control-h)] items-center justify-between gap-3">
          {row ? (
            <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium leading-5 text-fg-primary">
              <BrandLogo brand={row.platform} />
              {PLATFORM_NAMES[row.platform]}
            </span>
          ) : (
            <span className={cn(BAR, "h-4 w-28")} />
          )}
          <span className="flex shrink-0">{action}</span>
        </div>
        {row ? <StatusLine row={row} /> : <div className="mt-1 flex h-5 items-center"><span className={cn(BAR, "h-3.5 w-48")} /></div>}
      </div>
      {/* The cost label is the Übersicht's and needs two lines on the
          phone: it gets the widest column, and every value sits on the
          bottom line, level with the others. */}
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.25fr)] items-end gap-x-3 sm:gap-x-4 xl:contents">
        <Figure label="Werbebudget" skeleton={!row} value={off ? null : formatEuro(row!.spendEur)} />
        <Figure label="Anfragen" skeleton={!row} value={off ? null : formatNumber(row!.leads)} />
        <Figure
          label="Pro qualifizierte Anfrage"
          skeleton={!row}
          value={off || row!.cplEur == null ? null : formatEuro(row!.cplEur)}
        />
      </dl>
    </li>
  );
}

/** A figure of a platform: label over value in a block, a bare cell from xl. */
function Figure({ label, value, skeleton }: { label: string; value: string | null; skeleton: boolean }) {
  return (
    // From xl the figure stands on the name line, level with the name and the
    // row's button (the status line runs under them alone).
    <div className="min-w-0 xl:flex xl:h-[var(--control-h)] xl:flex-col xl:justify-center xl:text-right">
      <dt className="text-sm font-medium leading-5 text-fg-primary xl:sr-only">{label}</dt>
      <dd className="mt-1 flex h-5 items-center xl:mt-0 xl:justify-end">
        {skeleton ? (
          <span className={cn(BAR, "h-3.5 w-16")} />
        ) : (
          <span
            className={cn(
              "whitespace-nowrap text-[15px] font-semibold leading-5 tabular-nums xl:font-normal",
              value == null ? "text-fg-tertiary" : "text-fg-primary"
            )}
          >
            {value ?? "–"}
          </span>
        )}
      </dd>
    </div>
  );
}

const STATUS_DOT: Record<PlatformState, string> = {
  ok: "bg-tone-good",
  missing: "bg-[var(--border-hover)]",
  page: "bg-tone-warn",
  error: "bg-tone-bad",
};

/** A status is a dot plus plain text (DESIGN.md §5); the long story waits in the popover. */
function StatusLine({ row }: { row: PlatformView }) {
  const text =
    row.state === "ok"
      ? row.lastSyncedAt
        ? `Verbunden, Abgleich ${formatRelative(row.lastSyncedAt)}`
        : "Verbunden, noch kein Abgleich"
      : row.state === "missing"
        ? "Nicht verbunden"
        : row.state === "page"
          ? "Facebook-Seite fehlt"
          : "Synchronisierung fehlgeschlagen";
  return (
    <div className="mt-1 flex h-5 items-center gap-1.5 text-sm leading-5 text-fg-primary">
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[row.state])} />
      <span className="whitespace-nowrap">{text}</span>
      {row.state === "page" && (
        <ExplainerPopover term="Facebook-Seite">
          <p>
            Ihr Facebook-Konto verwaltet mehrere Seiten. Bitte wählen Sie die
            Seite Ihrer Praxis, damit Anfragen aus Meta-Formularen in Ihrem
            Portal ankommen.
          </p>
        </ExplainerPopover>
      )}
      {row.state === "error" && row.error && (
        <ExplainerPopover term="Synchronisierung">
          <p>{row.error}</p>
        </ExplainerPopover>
      )}
    </div>
  );
}

/** The row's one action, labelled with what it does to this platform. */
function PlatformAction({ row }: { row: PlatformView }) {
  if (!row.canConnect) return null;
  // Verbinden and Erneut verbinden start the platform's sign-in straight
  // away (the route Einstellungen' Werbekonten card uses) and come back here
  // once connected (`zurueck`, server/oauth.ts). The phone label is short:
  // the logo, the name and the status line next to it already say which
  // account and why.
  const start = `/api/integrations/${row.platform}/start?zurueck=/werbebudget`;
  const target =
    row.state === "missing"
      ? { href: start, label: `${PLATFORM_NAMES[row.platform]} verbinden`, short: "Verbinden" }
      : row.state === "page"
        ? { href: "/einstellungen/integrationen/meta-seite", label: "Facebook-Seite auswählen", short: "Seite wählen" }
        : row.state === "error"
          ? { href: start, label: "Erneut verbinden", short: "Neu verbinden" }
          : null;
  if (!target) return null;
  const content = (
    <>
      <LinkIcon className="h-4 w-4" aria-hidden />
      <span className="sm:hidden">{target.short}</span>
      <span className="hidden sm:inline">{target.label}</span>
    </>
  );
  // One width for every action on the page, so a row's button keeps its box
  // whatever it says.
  return (
    <Button asChild variant="outline" size="sm" className={cn(RAISED_CONTROL, CONTROL, WB_ACTION_WIDTH, "shrink-0 px-3")}>
      {target.href === start ? (
        // Plain <a>: a prefetched Link would hit the OAuth start route.
        <a href={target.href} aria-label={target.label}>{content}</a>
      ) : (
        <Link href={target.href} aria-label={target.label}>{content}</Link>
      )}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Kampagnen                                                            */
/* ------------------------------------------------------------------ */

export interface CampaignView {
  key: string;
  name: string;
  platform: string;
  spendEur: number;
  /**
   * The campaign's qualifizierte Anfragen (server/queries/_qualified.ts).
   * null: the platform sent no campaign id or name, nothing can be matched.
   */
  leads: number | null;
  /** Werbebudget ÷ qualifizierte Anfragen, as on the Übersicht. */
  cplEur: number | null;
}

/**
 * The campaigns of the period, largest Werbebudget first, as Stripe's table:
 * the header as a band pressed into the card (Linear), the name with its
 * platform logo (names wrap, never cut), figures right-aligned in the
 * Plattformen columns. A campaign counts only its qualifizierte Anfragen
 * (the platforms count every Anfrage), so that column says "Qualifiziert".
 * Below lg a row is the name with its Werbebudget and one meta line
 * (Linear's inbox). The list has one height in every period; more rows scroll
 * inside it, fewer leave it empty, none put one sentence in its middle.
 * `rows === null` draws the skeleton.
 */
export function CampaignsCard({ rows, emptyText }: { rows: CampaignView[] | null; emptyText: string }) {
  return (
    <DashCard title="Kampagnen" className="[--delay:90ms]">
      <div className="-mx-2">
        <div aria-hidden className={cn("mb-1 grid items-center gap-x-4 px-2", TABLE_HEAD_BAND, WB_CAMPAIGN_COLUMNS)}>
          <span>Kampagne</span>
          <span className="text-right">Werbebudget</span>
          <span className="hidden text-right lg:block">Qualifiziert</span>
          <span className="hidden text-right lg:block">Pro qualifizierte Anfrage</span>
        </div>
        <div className={cn("scroll-shadows [--scroll-bg:var(--surface-tile)]", WB_CAMPAIGN_LIST_HEIGHT)}>
          {rows === null ? (
            <ul className="divide-y divide-border">
              {[0, 1, 2].map((i) => (
                <li key={i} className={cn("grid items-center gap-x-4 px-2 py-3 lg:py-2", TABLE_ROW, WB_CAMPAIGN_COLUMNS)}>
                  <span className={cn(BAR, "h-4 w-48 max-w-full")} />
                  <span className={cn(BAR, "h-4 w-16 justify-self-end")} />
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <p className="flex h-full items-center justify-center px-6 text-center text-[15px] leading-5 text-fg-secondary">
              {emptyText}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.key}
                  className={cn("grid items-start gap-x-4 px-2 py-3 lg:items-center lg:py-2", TABLE_ROW, WB_CAMPAIGN_COLUMNS)}
                >
                  {/* The logo in a column of its own: a long first word wraps
                      beside it instead of leaving it alone on a line. */}
                  <span className="flex min-w-0 gap-1.5 text-[15px] font-medium leading-5 text-fg-primary">
                    {(r.platform === "meta" || r.platform === "google") && (
                      <span className="flex h-5 shrink-0 items-center">
                        <BrandLogo brand={r.platform} />
                      </span>
                    )}
                    <span className="min-w-0 hyphens-auto break-words">{r.name}</span>
                  </span>
                  <Num>{formatEuro(r.spendEur)}</Num>
                  <Num className="hidden lg:block" quiet={r.leads == null}>
                    {r.leads == null ? "–" : formatNumber(r.leads)}
                  </Num>
                  <Num className="hidden lg:block" quiet={r.cplEur == null}>
                    {r.cplEur == null ? "–" : formatEuro(r.cplEur)}
                  </Num>
                  <p className="col-span-2 mt-1 text-sm leading-5 text-fg-secondary lg:hidden">
                    {campaignMeta(r)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashCard>
  );
}

function Num({ children, className, quiet = false }: { children: ReactNode; className?: string; quiet?: boolean }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap text-right text-[15px] leading-5 tabular-nums",
        quiet ? "text-fg-tertiary" : "text-fg-primary",
        className
      )}
    >
      {children}
    </span>
  );
}

/** The phone's meta line: what the campaign brought, in one plain sentence. */
function campaignMeta(r: CampaignView): ReactNode {
  if (r.leads == null) return "Anfragen nicht zuordenbar";
  if (r.leads === 0) return "Keine qualifizierte Anfrage";
  return (
    <>
      {formatNumber(r.leads)} {r.leads === 1 ? "qualifizierte Anfrage" : "qualifizierte Anfragen"}
      {r.cplEur != null && (
        <>
          , <span className="whitespace-nowrap">{formatEuro(r.cplEur)}</span> pro Anfrage
        </>
      )}
    </>
  );
}
