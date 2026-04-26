import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { Badge } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import {
  PLAN_LABELS,
  REQUEST_STATUSES,
  REQUEST_SOURCES,
  AI_CATEGORIES,
  type Plan,
  type RequestSource,
  type RequestStatus,
} from "@/lib/constants";
import {
  clinicActivity,
  clinicPerformance,
  globalLeads,
  type AdminLeadFilters,
} from "@/server/queries/admin";
import { ClinicTabsNav } from "./_components/ClinicTabsNav";
import { OverviewTab } from "./_components/OverviewTab";
import { LeistungTab } from "./_components/LeistungTab";
import { LeadsTab } from "./_components/LeadsTab";
import { ActivityTab } from "./_components/ActivityTab";
import { TeamTab } from "./_components/TeamTab";
import { StammdatenTab } from "./_components/StammdatenTab";
import { IntegrationenTab } from "./_components/IntegrationenTab";
import { VerwaltungTab } from "./_components/VerwaltungTab";

export const metadata = { title: "Klinik-Details" };

const TABS = [
  { key: "uebersicht", label: "Übersicht" },
  { key: "leistung", label: "Leistung" },
  { key: "leads", label: "Leads" },
  { key: "aktivitaet", label: "Aktivität" },
  { key: "team", label: "Team" },
  { key: "stammdaten", label: "Stammdaten" },
  { key: "integrationen", label: "Integrationen" },
  { key: "verwaltung", label: "Verwaltung" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

interface PageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

const PERIOD_DAYS: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

const LEADS_PAGE_SIZE = 50;

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function AdminClinicDetailPage({
  params,
  searchParams,
}: PageProps) {
  await requireAdmin();

  const tabParam = (searchParams.tab as string | undefined) ?? "uebersicht";
  const tab: TabKey = (TABS.find((t) => t.key === tabParam)?.key ??
    "uebersicht") as TabKey;

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, params.id))
    .limit(1);
  if (!clinic) notFound();

  // Load just-enough data for the active tab. Header + counts are always
  // fetched so the chrome stays informative.
  const baseFetch = Promise.all([
    db
      .select({
        requests: sql<number>`(
          select count(*)::int from ${schema.requests}
          where ${schema.requests.clinicId} = ${clinic.id}
        )`,
        documents: sql<number>`(
          select count(*)::int from ${schema.documents}
          where ${schema.documents.clinicId} = ${clinic.id}
        )`,
        assets: sql<number>`(
          select count(*)::int from ${schema.assets}
          where ${schema.assets.clinicId} = ${clinic.id}
        )`,
      })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinic.id))
      .limit(1),
  ]);

  let renderedTab: React.ReactNode;

  if (tab === "uebersicht") {
    const [counts, perf] = await Promise.all([
      baseFetch.then(([c]) => c[0] ?? { requests: 0, documents: 0, assets: 0 }),
      clinicPerformance(clinic.id, 90),
    ]);
    renderedTab = <OverviewTab clinic={clinic} totals={counts} perf={perf} />;
  } else if (tab === "leistung") {
    const periodKey = (searchParams.period as string | undefined) ?? "90d";
    const days = PERIOD_DAYS[periodKey] ?? 90;
    const perf = await clinicPerformance(clinic.id, days);
    renderedTab = (
      <LeistungTab perf={perf} periodKey={periodKey} clinicId={clinic.id} />
    );
  } else if (tab === "leads") {
    const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
    const filters: AdminLeadFilters = {
      clinicIds: [clinic.id],
      status: asArray(searchParams.status).filter((s) =>
        (REQUEST_STATUSES as readonly string[]).includes(s)
      ) as RequestStatus[],
      source: asArray(searchParams.source).filter((s) =>
        (REQUEST_SOURCES as readonly string[]).includes(s as RequestSource)
      ),
      aiCategory: asArray(searchParams.aiCategory).filter((c) =>
        ["hot", "warm", "cold", "unscored"].includes(c)
      ) as ("hot" | "warm" | "cold" | "unscored")[],
      slaBreachedOnly: searchParams.slaBreachedOnly === "1",
      search:
        typeof searchParams.search === "string" && searchParams.search.length
          ? searchParams.search
          : undefined,
    };
    const result = await globalLeads(filters, {
      limit: LEADS_PAGE_SIZE,
      offset: (page - 1) * LEADS_PAGE_SIZE,
    });
    renderedTab = (
      <LeadsTab
        rows={result.items}
        total={result.total}
        aggregates={result.aggregates}
        page={page}
        filters={filters}
        searchParams={searchParams}
        clinicId={clinic.id}
      />
    );
  } else if (tab === "aktivitaet") {
    const data = await clinicActivity(clinic.id, 30);
    renderedTab = <ActivityTab data={data} />;
  } else if (tab === "team") {
    const team = await db
      .select()
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.clinicId, clinic.id))
      .orderBy(desc(schema.clinicUsers.createdAt));
    renderedTab = <TeamTab team={team} />;
  } else if (tab === "stammdaten") {
    renderedTab = <StammdatenTab clinic={clinic} />;
  } else if (tab === "integrationen") {
    const [creds, syncEvents] = await Promise.all([
      db
        .select()
        .from(schema.platformCredentials)
        .where(eq(schema.platformCredentials.clinicId, clinic.id)),
      db
        .select({
          id: schema.auditLog.id,
          createdAt: schema.auditLog.createdAt,
          action: schema.auditLog.action,
          diff: schema.auditLog.diff,
        })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.clinicId, clinic.id),
            eq(schema.auditLog.entityKind, "platform_credential")
          )
        )
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(20),
    ]);
    renderedTab = <IntegrationenTab creds={creds} syncHistory={syncEvents} />;
  } else if (tab === "verwaltung") {
    renderedTab = <VerwaltungTab clinic={clinic} />;
  } else {
    renderedTab = null;
  }

  const isArchived = clinic.archivedAt !== null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="text-xs text-fg-secondary">
            <Link href="/admin/clinics" className="hover:text-accent">
              Kliniken
            </Link>
            <span className="mx-1">/</span>
            <span className="font-mono">{clinic.slug}</span>
          </div>
          <h1 className="display-m">{clinic.displayName}</h1>
          <p className="text-lg text-fg-primary">{clinic.legalName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={clinic.plan === "erweitert" ? "good" : "neutral"}>
            Plan: {PLAN_LABELS[clinic.plan as Plan] ?? clinic.plan}
          </Badge>
          {isArchived ? (
            <Badge tone="bad">Archiviert</Badge>
          ) : (
            <Badge tone="good">Aktiv</Badge>
          )}
        </div>
      </header>

      <div className="border-y border-border py-2">
        <ClinicTabsNav tabs={[...TABS]} current={tab} />
      </div>

      <div>{renderedTab}</div>
    </div>
  );
}
