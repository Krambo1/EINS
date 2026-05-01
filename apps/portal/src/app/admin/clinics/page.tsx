import Link from "next/link";
import {
  Card,
  CardContent,
  Badge,
  Input,
  Button,
  MetricTile,
} from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { PLAN_LABELS, type Plan } from "@/lib/constants";
import {
  formatEuro,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/formatting";
import {
  clinicLeaderboard,
  type ClinicLeaderboardRow,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";

export const metadata = { title: "Kliniken" };

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

const SORT_KEYS = [
  "name",
  "spend",
  "revenue",
  "roas",
  "leads",
  "cases",
  "lastActivity",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

interface PageProps {
  searchParams: {
    plan?: string;
    status?: string;
    health?: string;
    activity?: string;
    search?: string;
    sort?: string;
    dir?: string;
  };
}

const TONE_DOT: Record<ClinicLeaderboardRow["healthTone"], string> = {
  good: "bg-tone-good",
  warn: "bg-tone-warn",
  bad: "bg-tone-bad",
  neutral: "bg-bg-tertiary",
};
const TONE_LABEL: Record<ClinicLeaderboardRow["healthTone"], string> = {
  good: "Gesund",
  warn: "Beobachten",
  bad: "Reagieren",
  neutral: "Keine Daten",
};

export default async function AdminClinicsPage({ searchParams }: PageProps) {
  await requireAdmin();

  const all = await clinicLeaderboard({ periodDays: 30 });

  // Apply filters
  const filtered = all.filter((c) => {
    if (searchParams.plan && searchParams.plan !== "alle") {
      if (c.plan !== searchParams.plan) return false;
    }
    if (searchParams.status === "active" && c.archivedAt) return false;
    if (searchParams.status === "archived" && !c.archivedAt) return false;
    if (searchParams.health && searchParams.health !== "alle") {
      if (c.healthTone !== searchParams.health) return false;
    }
    if (searchParams.activity && searchParams.activity !== "alle") {
      const days = activityDays(c.lastActivityAt);
      if (searchParams.activity === "7" && days > 7) return false;
      if (searchParams.activity === "30" && days > 30) return false;
      if (searchParams.activity === "older" && days <= 30) return false;
    }
    if (searchParams.search) {
      const term = searchParams.search.toLowerCase();
      if (
        !c.name.toLowerCase().includes(term) &&
        !c.slug.toLowerCase().includes(term)
      ) {
        return false;
      }
    }
    return true;
  });

  const sortKey = isSortKey(searchParams.sort) ? searchParams.sort : "roas";
  const dir = searchParams.dir === "asc" ? "asc" : "desc";
  const sorted = [...filtered].sort((a, b) => sortRows(a, b, sortKey, dir));

  // Aggregate cards
  const totalSpend = sorted.reduce((acc, r) => acc + r.spendEur, 0);
  const totalRevenue = sorted.reduce((acc, r) => acc + r.revenueEur, 0);
  const totalLeads = sorted.reduce((acc, r) => acc + r.leads, 0);
  const totalCases = sorted.reduce((acc, r) => acc + r.casesWon, 0);
  const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Alle Kliniken"
        subtitle={`${sorted.length} von ${all.length} Kliniken sichtbar. Zahlen sind 30-Tage-Werte.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Werbebudget"
          value={formatEuro(totalSpend)}
          sublabel="30 Tage"
        />
        <MetricTile
          label="Werbeumsatz"
          value={formatEuro(totalRevenue)}
          sublabel="30 Tage"
          tone="accent"
        />
        <MetricTile
          label="Ø ROAS"
          value={avgRoas == null ? "–" : `${avgRoas.toFixed(2)}×`}
          sublabel={`${formatNumber(totalLeads)} Leads`}
        />
        <MetricTile
          label="Cases gewonnen"
          value={formatNumber(totalCases)}
          sublabel="30 Tage"
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="pt-6">
          <form className="grid gap-3 md:grid-cols-[2fr_repeat(4,1fr)_auto]" method="get">
            <Input
              name="search"
              placeholder="Suche: Klinikname oder Slug"
              defaultValue={searchParams.search ?? ""}
            />
            <select
              name="plan"
              defaultValue={searchParams.plan ?? "alle"}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
            >
              <option value="alle">Plan: alle</option>
              <option value="standard">Standard</option>
              <option value="erweitert">Erweitert</option>
            </select>
            <select
              name="status"
              defaultValue={searchParams.status ?? "active"}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
            >
              <option value="active">Status: aktiv</option>
              <option value="archived">Status: archiviert</option>
              <option value="alle">Status: alle</option>
            </select>
            <select
              name="health"
              defaultValue={searchParams.health ?? "alle"}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
            >
              <option value="alle">Health: alle</option>
              <option value="good">Gesund</option>
              <option value="warn">Beobachten</option>
              <option value="bad">Reagieren</option>
              <option value="neutral">Keine Daten</option>
            </select>
            <select
              name="activity"
              defaultValue={searchParams.activity ?? "alle"}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
            >
              <option value="alle">Aktivität: alle</option>
              <option value="7">Letzte 7 Tage</option>
              <option value="30">Letzte 30 Tage</option>
              <option value="older">Älter als 30 Tage</option>
            </select>
            <Button type="submit" size="sm">
              Filtern
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className={`${GLOW_CARD} !p-0 overflow-hidden`}>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg-secondary/40 text-left text-xs text-fg-secondary">
                <tr>
                  <SortableTh
                    label="Name"
                    sortKey="name"
                    current={sortKey}
                    dir={dir}
                    searchParams={searchParams}
                  />
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2 text-right">MRR</th>
                  <SortableTh
                    label="Spend"
                    sortKey="spend"
                    current={sortKey}
                    dir={dir}
                    searchParams={searchParams}
                    align="right"
                  />
                  <SortableTh
                    label="Umsatz"
                    sortKey="revenue"
                    current={sortKey}
                    dir={dir}
                    searchParams={searchParams}
                    align="right"
                  />
                  <SortableTh
                    label="ROAS"
                    sortKey="roas"
                    current={sortKey}
                    dir={dir}
                    searchParams={searchParams}
                    align="right"
                  />
                  <SortableTh
                    label="Leads"
                    sortKey="leads"
                    current={sortKey}
                    dir={dir}
                    searchParams={searchParams}
                    align="right"
                  />
                  <SortableTh
                    label="Cases"
                    sortKey="cases"
                    current={sortKey}
                    dir={dir}
                    searchParams={searchParams}
                    align="right"
                  />
                  <th className="px-3 py-2 text-right">No-Show</th>
                  <SortableTh
                    label="Aktivität"
                    sortKey="lastActivity"
                    current={sortKey}
                    dir={dir}
                    searchParams={searchParams}
                    align="right"
                  />
                  <th className="px-3 py-2">Health</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr
                    key={c.clinicId}
                    className="border-b border-border last:border-b-0 hover:bg-bg-secondary/30"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/clinics/${c.clinicId}`}
                        className="font-medium text-fg-primary hover:text-accent"
                      >
                        {c.name}
                      </Link>
                      <div className="font-mono text-xs text-fg-secondary">
                        {c.slug}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={c.plan === "erweitert" ? "good" : "neutral"}>
                        {PLAN_LABELS[c.plan as Plan] ?? c.plan}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {c.mrrEur > 0 ? formatEuro(c.mrrEur) : "–"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatEuro(c.spendEur)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatEuro(c.revenueEur)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {c.roas == null ? "–" : `${c.roas.toFixed(2)}×`}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatNumber(c.leads)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatNumber(c.casesWon)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {c.noShowRate == null ? "–" : formatPercent(c.noShowRate)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-fg-secondary">
                      {c.lastActivityAt
                        ? formatRelative(c.lastActivityAt)
                        : "–"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_DOT[c.healthTone]}`}
                          aria-hidden
                        />
                        {TONE_LABEL[c.healthTone]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {c.archivedAt ? (
                        <Badge tone="bad">Archiviert</Badge>
                      ) : (
                        <Badge tone="good">Aktiv</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-4 py-10 text-center text-fg-secondary"
                    >
                      Keine Klinik passt zu den aktuellen Filtern.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function isSortKey(s: string | undefined): s is SortKey {
  return !!s && (SORT_KEYS as readonly string[]).includes(s);
}

function sortRows(
  a: ClinicLeaderboardRow,
  b: ClinicLeaderboardRow,
  key: SortKey,
  dir: "asc" | "desc"
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "name":
      return sign * a.name.localeCompare(b.name, "de");
    case "spend":
      return sign * (a.spendEur - b.spendEur);
    case "revenue":
      return sign * (a.revenueEur - b.revenueEur);
    case "roas":
      return sign * ((a.roas ?? -1) - (b.roas ?? -1));
    case "leads":
      return sign * (a.leads - b.leads);
    case "cases":
      return sign * (a.casesWon - b.casesWon);
    case "lastActivity":
      return (
        sign *
        ((a.lastActivityAt?.getTime() ?? 0) - (b.lastActivityAt?.getTime() ?? 0))
      );
  }
}

function activityDays(d: Date | null): number {
  if (!d) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function SortableTh({
  label,
  sortKey,
  current,
  dir,
  searchParams,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  searchParams: PageProps["searchParams"];
  align?: "right";
}) {
  const isActive = sortKey === current;
  const nextDir = isActive && dir === "desc" ? "asc" : "desc";
  const arrow = !isActive ? "" : dir === "desc" ? "↓" : "↑";
  return (
    <th
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <Link
        href={{
          pathname: "/admin/clinics",
          query: { ...searchParams, sort: sortKey, dir: nextDir },
        }}
        className={`hover:text-accent ${isActive ? "text-accent" : ""}`}
      >
        {label} {arrow}
      </Link>
    </th>
  );
}
