"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, Badge, Button, MetricTile } from "@eins/ui";
import { setSearchParams } from "@/app/_components/instant-views";
import {
  formatClinicAggregate,
  formatEuro,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatRoas,
} from "@/lib/formatting";
import type { ClinicLeaderboardRow } from "@/server/queries/admin";
import { AdminPageHeader } from "../../_components/AdminPageHeader";
import {
  AdminFiltersInBrowser,
  AdminSearchInput,
  AdminUrlSelect,
} from "../../_components/AdminFilters";
import { AdminTable, type AdminColumn } from "../../_components/AdminTable";

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

const STATUS_OPTIONS = [
  { value: "active", label: "Status: aktiv" },
  { value: "archived", label: "Status: archiviert" },
  { value: "alle", label: "Status: alle" },
];
const HEALTH_OPTIONS = [
  { value: "alle", label: "Zustand: alle" },
  { value: "good", label: "Gesund" },
  { value: "warn", label: "Beobachten" },
  { value: "bad", label: "Reagieren" },
  { value: "neutral", label: "Keine Daten" },
];
const ACTIVITY_OPTIONS = [
  { value: "alle", label: "Aktivität: alle" },
  { value: "7", label: "Letzte 7 Tage" },
  { value: "30", label: "Letzte 30 Tage" },
  { value: "older", label: "Älter als 30 Tage" },
];

/**
 * The Praxen board: tiles, filters and table. The server sends every Praxis
 * once; status, Zustand, Aktivität, search and sort run here on the address
 * (history.replaceState via AdminFiltersInBrowser), so every switch is
 * instant and a reload or a shared link opens the same view.
 */
export function ClinicsBoard({ all, notice }: { all: ClinicLeaderboardRow[]; notice?: ReactNode }) {
  const sp = useSearchParams();
  const params = {
    status: sp.get("status") ?? undefined,
    health: sp.get("health") ?? undefined,
    activity: sp.get("activity") ?? undefined,
    search: sp.get("search") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    dir: sp.get("dir") ?? undefined,
  };

  const filtered = all.filter((c) => {
    if (params.status === "active" && c.archivedAt) return false;
    if (params.status === "archived" && !c.archivedAt) return false;
    if (params.status == null && c.archivedAt) return false; // default = active
    if (params.health && params.health !== "alle") {
      if (c.healthTone !== params.health) return false;
    }
    if (params.activity && params.activity !== "alle") {
      const days = activityDays(c.lastActivityAt);
      if (params.activity === "7" && days > 7) return false;
      if (params.activity === "30" && days > 30) return false;
      if (params.activity === "older" && days <= 30) return false;
    }
    if (params.search) {
      const term = params.search.toLowerCase();
      if (
        !c.name.toLowerCase().includes(term) &&
        !c.slug.toLowerCase().includes(term)
      ) {
        return false;
      }
    }
    return true;
  });

  // Anfragen first: every Praxis has them from day one, Werbeertrag only once
  // ads run (organisch zuerst).
  const sortKey = isSortKey(params.sort) ? params.sort : "leads";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const sorted = [...filtered].sort((a, b) => sortRows(a, b, sortKey, dir));

  const baseQuery: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (k !== "hinweis") baseQuery[k] = v;
  });

  const totalSpend = sorted.reduce((acc, r) => acc + r.spendEur, 0);
  const totalRevenue = sorted.reduce((acc, r) => acc + r.revenueEur, 0);
  const totalLeads = sorted.reduce((acc, r) => acc + r.leads, 0);
  const totalCases = sorted.reduce((acc, r) => acc + r.casesWon, 0);
  const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;

  const activeChips = buildChips(params);

  const columns: AdminColumn<ClinicLeaderboardRow>[] = [
    {
      key: "name",
      header: <SortLink label="Name" sortKey="name" current={sortKey} dir={dir} baseQuery={baseQuery} />,
      render: (c) => (
        <>
          <Link
            href={`/admin/clinics/${c.clinicId}`}
            className="font-medium text-fg-primary hover:text-accent"
          >
            {c.name}
          </Link>
          <div className="font-mono text-xs text-fg-secondary">{c.slug}</div>
        </>
      ),
    },
    {
      key: "revenue",
      align: "right",
      header: <SortLink label="Umsatz" sortKey="revenue" current={sortKey} dir={dir} baseQuery={baseQuery} align />,
      render: (c) => <span className="tabular-nums">{formatMoney(c.revenueEur, c.currency)}</span>,
    },
    {
      key: "roas",
      align: "right",
      header: <SortLink label="Werbeertrag" sortKey="roas" current={sortKey} dir={dir} baseQuery={baseQuery} align />,
      render: (c) => (
        <span className="tabular-nums">{formatRoas(c.roas)}</span>
      ),
    },
    {
      key: "leads",
      align: "right",
      header: <SortLink label="Anfragen" sortKey="leads" current={sortKey} dir={dir} baseQuery={baseQuery} align />,
      render: (c) => <span className="tabular-nums">{formatNumber(c.leads)}</span>,
    },
    {
      key: "cases",
      align: "right",
      header: <SortLink label="Abschlüsse" sortKey="cases" current={sortKey} dir={dir} baseQuery={baseQuery} align />,
      render: (c) => <span className="tabular-nums">{formatNumber(c.casesWon)}</span>,
    },
    {
      key: "health",
      header: "Zustand",
      render: (c) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_DOT[c.healthTone]}`} aria-hidden />
          {TONE_LABEL[c.healthTone]}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) =>
        c.archivedAt ? <Badge tone="bad">Archiviert</Badge> : <Badge tone="good">Aktiv</Badge>,
    },
    {
      key: "spend",
      secondary: true,
      detailLabel: "Werbebudget",
      header: "Budget",
      render: (c) => formatEuro(c.spendEur),
    },
    {
      key: "noShow",
      secondary: true,
      detailLabel: "Nicht erschienen",
      header: "Nicht erschienen",
      render: (c) => (c.noShowRate == null ? "–" : formatPercent(c.noShowRate)),
    },
    {
      key: "lastActivity",
      secondary: true,
      detailLabel: "Aktivität",
      header: "Aktivität",
      render: (c) => (c.lastActivityAt ? formatRelative(c.lastActivityAt) : "–"),
    },
    {
      key: "action",
      align: "right",
      header: "Aktion",
      render: (c) =>
        c.archivedAt ? (
          <span className="text-xs text-fg-secondary">–</span>
        ) : (
          <form
            action="/admin/start-impersonation"
            method="POST"
            target="_blank"
            rel="noopener noreferrer"
            className="flex justify-end"
          >
            <input type="hidden" name="clinicId" value={c.clinicId} />
            <Button type="submit" size="sm" variant="outline" title={`Portal als ${c.name} öffnen (als Inhaber)`}>
              Öffnen
            </Button>
          </form>
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Alle Praxen"
        subtitle={`${sorted.length} von ${all.length} Praxen sichtbar. Zahlen sind 30-Tage-Werte.`}
        actions={
          <Button asChild>
            <Link href="/admin/clinics/neu">Neue Praxis</Link>
          </Button>
        }
      />

      {notice}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Werbebudget" value={formatEuro(totalSpend)} sublabel="30 Tage" />
        <MetricTile
          label="Werbeumsatz"
          value={formatClinicAggregate(totalRevenue, sorted.map((r) => r.currency))}
          sublabel="30 Tage"
          tone="accent"
        />
        <MetricTile
          label="Ø Werbeertrag"
          value={formatRoas(avgRoas)}
          sublabel={`${formatNumber(totalLeads)} Anfragen`}
        />
        <MetricTile label="Abschlüsse" value={formatNumber(totalCases)} sublabel="30 Tage" />
      </div>

      <Card>
        <CardContent className="pt-6">
          <AdminFiltersInBrowser>
            <div className="grid gap-3 md:grid-cols-[2fr_repeat(3,1fr)]">
              <AdminSearchInput placeholder="Praxisname oder Slug" />
              <AdminUrlSelect param="status" value={params.status ?? "active"} options={STATUS_OPTIONS} />
              <AdminUrlSelect param="health" value={params.health ?? "alle"} options={HEALTH_OPTIONS} />
              <AdminUrlSelect param="activity" value={params.activity ?? "alle"} options={ACTIVITY_OPTIONS} />
            </div>
          </AdminFiltersInBrowser>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-primary">
            <span className="font-medium">Aktive Filter:</span>
            {activeChips.length === 0 ? (
              <Badge tone="neutral">Keine</Badge>
            ) : (
              activeChips.map((c) => (
                <Badge key={c.key} tone={c.tone}>
                  {c.label}
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <CardContent className="p-0">
          <AdminTable
            columns={columns}
            rows={sorted}
            getRowKey={(c) => c.clinicId}
            empty="Keine Praxis passt zu den aktuellen Filtern."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function buildChips(params: {
  status?: string;
  health?: string;
  activity?: string;
  search?: string;
}): { key: string; label: string; tone: "neutral" | "bad" | "warn" }[] {
  const chips: { key: string; label: string; tone: "neutral" | "bad" | "warn" }[] = [];
  if (params.status && params.status !== "active") {
    chips.push({ key: "status", label: `Status: ${params.status}`, tone: "neutral" });
  }
  if (params.health && params.health !== "alle") {
    const label = HEALTH_OPTIONS.find((o) => o.value === params.health)?.label ?? params.health;
    chips.push({ key: "health", label, tone: params.health === "bad" ? "bad" : "neutral" });
  }
  if (params.activity && params.activity !== "alle") {
    const label = ACTIVITY_OPTIONS.find((o) => o.value === params.activity)?.label ?? params.activity;
    chips.push({ key: "activity", label, tone: "neutral" });
  }
  if (params.search) {
    chips.push({ key: "search", label: `Suche: ${params.search}`, tone: "neutral" });
  }
  return chips;
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

function SortLink({
  label,
  sortKey,
  current,
  dir,
  baseQuery,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  baseQuery: Record<string, string>;
  align?: boolean;
}) {
  const isActive = sortKey === current;
  const nextDir = isActive && dir === "desc" ? "asc" : "desc";
  const arrow = !isActive ? "" : dir === "desc" ? "↓" : "↑";
  return (
    <Link
      href={{
        pathname: "/admin/clinics",
        query: { ...baseQuery, sort: sortKey, dir: nextDir },
      }}
      scroll={false}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        setSearchParams({ sort: sortKey, dir: nextDir, hinweis: null });
      }}
      className={`hover:text-accent ${isActive ? "text-accent" : ""} ${align ? "inline-block w-full text-right" : ""}`}
    >
      {label} {arrow}
    </Link>
  );
}
