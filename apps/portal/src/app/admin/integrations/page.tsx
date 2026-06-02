import Link from "next/link";
import {
  Card,
  CardContent,
  Badge,
  MetricTile,
  TrafficLightCard,
} from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatNumber, formatRelative } from "@/lib/formatting";
import {
  adminIntegrationHealth,
  type AdminIntegrationRow,
} from "@/server/queries/admin";
import type { ToneKey } from "@/server/constants/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AdminTable, type AdminColumn } from "../_components/AdminTable";

export const metadata = { title: "Integrationen · Admin" };

const GLOW_CARD = "!bg-bg-secondary";
const TOKEN_SOON_MS = 7 * 86_400_000;
const STALE_SYNC_MS = 48 * 3_600_000;

const PROVIDER_LABEL: Record<string, string> = {
  meta: "Meta / Instagram",
  google: "Google Ads",
  intake: "Intake-Formular",
  pvs: "PVS-Bridge",
  csv: "CSV-Import",
};

const STATUS_LABEL: Record<ToneKey, string> = {
  good: "Verbunden",
  warn: "Beobachten",
  bad: "Fehler",
  neutral: "Offen",
};
const STATUS_TONE: Record<ToneKey, "good" | "warn" | "bad" | "neutral"> = {
  good: "good",
  warn: "warn",
  bad: "bad",
  neutral: "neutral",
};

const TONE_ORDER: Record<ToneKey, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };

export default async function AdminIntegrationsPage() {
  await requireAdmin();

  const rows = await adminIntegrationHealth();
  const now = Date.now();

  const total = rows.length;
  const withError = rows.filter((r) => r.lastSyncError).length;
  const tokenSoon = rows.filter(
    (r) => r.tokenExpiresAt && new Date(r.tokenExpiresAt).getTime() < now + TOKEN_SOON_MS
  ).length;
  const stale = rows.filter(
    (r) => r.lastSyncedAt == null || now - new Date(r.lastSyncedAt).getTime() > STALE_SYNC_MS
  ).length;

  // One traffic-light card per provider, worst tone wins.
  const byProvider = new Map<string, AdminIntegrationRow[]>();
  for (const r of rows) {
    const list = byProvider.get(r.provider) ?? [];
    list.push(r);
    byProvider.set(r.provider, list);
  }
  const providerCards = [...byProvider.entries()]
    .map(([provider, list]) => {
      const worst = list.reduce<ToneKey>(
        (acc, r) => (TONE_ORDER[r.tone] < TONE_ORDER[acc] ? r.tone : acc),
        "good"
      );
      const errors = list.filter((r) => r.lastSyncError).length;
      return { provider, worst, count: list.length, errors };
    })
    .sort((a, b) => TONE_ORDER[a.worst] - TONE_ORDER[b.worst]);

  const columns: AdminColumn<AdminIntegrationRow>[] = [
    {
      key: "clinic",
      header: "Praxis",
      render: (r) => (
        <Link
          href={`/admin/clinics/${r.clinicId}?tab=integrationen`}
          className="text-fg-primary hover:text-accent"
        >
          {r.clinicName}
        </Link>
      ),
    },
    {
      key: "provider",
      header: "Plattform",
      render: (r) => PROVIDER_LABEL[r.provider] ?? r.provider,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={STATUS_TONE[r.tone]}>{STATUS_LABEL[r.tone]}</Badge>,
    },
    {
      key: "lastSync",
      align: "right",
      header: "Letzter Sync",
      render: (r) => (
        <span className="text-fg-secondary">
          {r.lastSyncedAt ? formatRelative(r.lastSyncedAt) : "nie"}
        </span>
      ),
    },
    {
      key: "token",
      align: "right",
      secondary: true,
      detailLabel: "Token läuft ab",
      header: "Token",
      render: (r) =>
        r.tokenExpiresAt ? formatRelative(r.tokenExpiresAt) : "kein Ablauf",
    },
    {
      key: "konto",
      secondary: true,
      detailLabel: "Konto",
      header: "Konto",
      render: (r) => <span className="font-mono text-xs">{r.accountId ?? "–"}</span>,
    },
    {
      key: "error",
      secondary: true,
      detailLabel: "Fehler",
      header: "Fehler",
      render: (r) =>
        r.lastSyncError ? (
          <span className="text-tone-bad">{r.lastSyncError}</span>
        ) : (
          "–"
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Integrations-Health"
        subtitle="Alle Plattform-Verbindungen aller Praxen auf einen Blick. Token-Ablauf, Sync-Stand und Fehler."
        actions={
          <Link
            href="/admin/operations"
            className="rounded-full border border-border px-4 py-2 text-sm text-fg-secondary transition-colors hover:border-accent hover:text-accent"
          >
            Sync-Fehler-Queue
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Verbindungen gesamt" value={formatNumber(total)} sublabel="alle Praxen" />
        <MetricTile
          label="Mit Fehler"
          value={formatNumber(withError)}
          sublabel="letzter Sync schlug fehl"
          tone={withError > 0 ? "bad" : "good"}
        />
        <MetricTile
          label="Token läuft bald ab"
          value={formatNumber(tokenSoon)}
          sublabel="< 7 Tage oder abgelaufen"
          tone={tokenSoon > 0 ? "warn" : "neutral"}
        />
        <MetricTile
          label="Veraltet"
          value={formatNumber(stale)}
          sublabel="kein Sync seit > 48 Std"
          tone={stale > 0 ? "warn" : "neutral"}
        />
      </div>

      {providerCards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providerCards.map((p) => (
            <TrafficLightCard
              key={p.provider}
              tone={p.worst}
              compact
              title={PROVIDER_LABEL[p.provider] ?? p.provider}
              diagnosis={
                p.errors > 0
                  ? `${formatNumber(p.count)} Verbindungen, ${formatNumber(p.errors)} mit Fehler.`
                  : `${formatNumber(p.count)} Verbindungen, alle synchron.`
              }
            />
          ))}
        </div>
      )}

      <Card className={`${GLOW_CARD} !p-0 overflow-hidden`}>
        <CardContent className="p-0">
          <AdminTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => `${r.clinicId}-${r.provider}`}
            empty="Noch keine Plattform-Verbindungen angelegt."
          />
        </CardContent>
      </Card>
    </div>
  );
}
