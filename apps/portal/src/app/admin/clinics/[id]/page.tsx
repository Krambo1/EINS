import { notFound } from "next/navigation";
import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Badge } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import {
  REQUEST_STATUSES,
  REQUEST_SOURCES,
  AI_CATEGORIES,
  type RequestSource,
  type RequestStatus,
} from "@/lib/constants";
import {
  clinicActivity,
  clinicPerformance,
  globalLeads,
  type AdminLeadFilters,
} from "@/server/queries/admin";
import {
  getAdminClinicById,
  getAdminClinicCounts,
} from "@/server/queries/admin-shared";
import { ClinicTabsNav } from "./_components/ClinicTabsNav";
import { OverviewTab } from "./_components/OverviewTab";
import { LeistungTab } from "./_components/LeistungTab";
import { LeadsTab } from "./_components/LeadsTab";
import { ActivityTab } from "./_components/ActivityTab";
import { TeamTab } from "./_components/TeamTab";
import { StammdatenTab } from "./_components/StammdatenTab";
import { IntegrationenTab } from "./_components/IntegrationenTab";
import { VerwaltungTab } from "./_components/VerwaltungTab";
import { FortschrittTab } from "./_components/FortschrittTab";
import {
  FragebogenTab,
  type FragebogenTabData,
} from "./_components/FragebogenTab";
import {
  ChecklisteTab,
  type ChecklisteTabData,
} from "./_components/ChecklisteTab";
import { DateienTab, type DateienTabData } from "./_components/DateienTab";
import type { DiscoveryAnswers } from "@/app/(portal)/onboarding/fragebogen/content";
import {
  ALL_CHECKLIST_ITEMS,
  type ChecklistAnswer,
  type ChecklistStatus,
} from "@/app/(portal)/onboarding/checkliste/content";

export const metadata = { title: "Praxis-Details" };

const TABS = [
  { key: "uebersicht", label: "Übersicht" },
  { key: "leistung", label: "Leistung" },
  { key: "leads", label: "Anfragen" },
  { key: "aktivitaet", label: "Aktivität" },
  { key: "fortschritt", label: "Fortschritt" },
  { key: "fragebogen", label: "Fragebogen" },
  { key: "checkliste", label: "Checkliste" },
  { key: "dateien", label: "Dateien" },
  { key: "team", label: "Team" },
  { key: "stammdaten", label: "Stammdaten" },
  { key: "integrationen", label: "Integrationen" },
  { key: "verwaltung", label: "Verwaltung" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const { id } = await params;
  const sp = await searchParams;

  const tabParam = (sp.tab as string | undefined) ?? "uebersicht";
  const tab: TabKey = (TABS.find((t) => t.key === tabParam)?.key ??
    "uebersicht") as TabKey;

  const clinic = await getAdminClinicById(id);
  if (!clinic) notFound();

  let renderedTab: React.ReactNode;

  if (tab === "uebersicht") {
    const [counts, perf] = await Promise.all([
      getAdminClinicCounts(clinic.id),
      clinicPerformance(clinic.id, 90),
    ]);
    renderedTab = <OverviewTab clinic={clinic} totals={counts} perf={perf} />;
  } else if (tab === "leistung") {
    const periodKey = (sp.period as string | undefined) ?? "90d";
    const days = PERIOD_DAYS[periodKey] ?? 90;
    const perf = await clinicPerformance(clinic.id, days);
    renderedTab = (
      <LeistungTab perf={perf} periodKey={periodKey} clinicId={clinic.id} />
    );
  } else if (tab === "leads") {
    const page = Math.max(1, Number(sp.page ?? 1) || 1);
    const filters: AdminLeadFilters = {
      clinicIds: [clinic.id],
      status: asArray(sp.status).filter((s) =>
        (REQUEST_STATUSES as readonly string[]).includes(s)
      ) as RequestStatus[],
      source: asArray(sp.source).filter((s) =>
        (REQUEST_SOURCES as readonly string[]).includes(s as RequestSource)
      ),
      aiCategory: asArray(sp.aiCategory).filter((c) =>
        ["hot", "warm", "cold", "unscored"].includes(c)
      ) as ("hot" | "warm" | "cold" | "unscored")[],
      slaBreachedOnly: sp.slaBreachedOnly === "1",
      search:
        typeof sp.search === "string" && sp.search.length
          ? sp.search
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
        searchParams={sp}
        clinicId={clinic.id}
      />
    );
  } else if (tab === "aktivitaet") {
    const data = await clinicActivity(clinic.id, 30);
    renderedTab = <ActivityTab data={data} />;
  } else if (tab === "fortschritt") {
    const entries = await db
      .select()
      .from(schema.clinicTimelineEntries)
      .where(eq(schema.clinicTimelineEntries.clinicId, clinic.id))
      .orderBy(desc(schema.clinicTimelineEntries.eventDate));
    renderedTab = <FortschrittTab clinicId={clinic.id} entries={entries} />;
  } else if (tab === "fragebogen") {
    // Admin connection bypasses RLS by role; explicit clinic filter scopes it.
    const [row] = await db
      .select({
        status: schema.discoveryFragebogen.status,
        answers: schema.discoveryFragebogen.answers,
        submittedAt: schema.discoveryFragebogen.submittedAt,
        resubmittedAt: schema.discoveryFragebogen.resubmittedAt,
        updatedAt: schema.discoveryFragebogen.updatedAt,
        submittedByName: schema.clinicUsers.fullName,
        submittedByEmail: schema.clinicUsers.email,
      })
      .from(schema.discoveryFragebogen)
      .leftJoin(
        schema.clinicUsers,
        eq(schema.discoveryFragebogen.submittedBy, schema.clinicUsers.id)
      )
      .where(eq(schema.discoveryFragebogen.clinicId, clinic.id))
      .limit(1);
    const data: FragebogenTabData | null = row
      ? {
          status: row.status as "entwurf" | "eingereicht",
          answers: (row.answers ?? {}) as DiscoveryAnswers,
          submittedAt: row.submittedAt,
          resubmittedAt: row.resubmittedAt,
          submittedByName: row.submittedByName ?? row.submittedByEmail,
          updatedAt: row.updatedAt,
        }
      : null;
    renderedTab = <FragebogenTab data={data} />;
  } else if (tab === "checkliste") {
    const [itemRows, fileRows] = await Promise.all([
      db
        .select()
        .from(schema.checklistItems)
        .where(eq(schema.checklistItems.clinicId, clinic.id)),
      db
        .select()
        .from(schema.checklistFiles)
        .where(eq(schema.checklistFiles.clinicId, clinic.id))
        .orderBy(asc(schema.checklistFiles.uploadedAt)),
    ]);
    const states: ChecklisteTabData["states"] = {};
    for (const item of ALL_CHECKLIST_ITEMS) {
      states[item.id] = {
        status: "offen",
        answer: {},
        files: [],
        deliveredAt: null,
        verifiedAt: null,
        verifiedBy: null,
      };
    }
    for (const row of itemRows) {
      if (!states[row.itemId]) continue;
      states[row.itemId] = {
        status: row.status as ChecklistStatus,
        answer: (row.answer ?? {}) as ChecklistAnswer,
        files: [],
        deliveredAt: row.deliveredAt,
        verifiedAt: row.verifiedAt,
        verifiedBy: row.verifiedBy,
      };
    }
    for (const f of fileRows) {
      const bucket = states[f.itemId];
      if (!bucket) continue;
      // Admin-scoped passthrough (redirects to a signed URL under R2).
      bucket.files.push({
        id: f.id,
        name: f.originalFilename,
        sizeBytes: f.sizeBytes,
        url: `/api/admin/files/${encodeURI(f.storageKey)}`,
      });
    }
    renderedTab = (
      <ChecklisteTab data={{ clinicId: clinic.id, states }} />
    );
  } else if (tab === "dateien") {
    const uploadRows = await db
      .select({
        id: schema.clientUploads.id,
        storageKey: schema.clientUploads.storageKey,
        originalFilename: schema.clientUploads.originalFilename,
        sizeBytes: schema.clientUploads.sizeBytes,
        note: schema.clientUploads.note,
        createdAt: schema.clientUploads.createdAt,
        seenAt: schema.clientUploads.seenAt,
        seenBy: schema.clientUploads.seenBy,
        uploaderName: schema.clinicUsers.fullName,
        uploaderEmail: schema.clinicUsers.email,
      })
      .from(schema.clientUploads)
      .leftJoin(
        schema.clinicUsers,
        eq(schema.clientUploads.uploadedBy, schema.clinicUsers.id)
      )
      .where(eq(schema.clientUploads.clinicId, clinic.id))
      .orderBy(desc(schema.clientUploads.createdAt));
    const data: DateienTabData = {
      clinicId: clinic.id,
      uploads: uploadRows.map((r) => ({
        id: r.id,
        name: r.originalFilename,
        sizeBytes: r.sizeBytes,
        // Admin-scoped passthrough (redirects to a signed URL under R2).
        url: `/api/admin/files/${encodeURI(r.storageKey)}`,
        note: r.note,
        createdAt: r.createdAt,
        seenAt: r.seenAt,
        seenBy: r.seenBy,
        uploaderName: r.uploaderName ?? r.uploaderEmail,
      })),
    };
    renderedTab = <DateienTab data={data} />;
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
    const [
      creds,
      syncEvents,
      outboxRows,
      outboxCounts,
      agentStatusRow,
      agentFailurePrunes,
    ] = await Promise.all([
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
      db
        .select({
          id: schema.adsConversionOutbox.id,
          channel: schema.adsConversionOutbox.channel,
          status: schema.adsConversionOutbox.status,
          valueEur: schema.adsConversionOutbox.valueEur,
          createdAt: schema.adsConversionOutbox.createdAt,
          sentAt: schema.adsConversionOutbox.sentAt,
          responseCode: schema.adsConversionOutbox.responseCode,
          responseBody: schema.adsConversionOutbox.responseBody,
        })
        .from(schema.adsConversionOutbox)
        .where(eq(schema.adsConversionOutbox.clinicId, clinic.id))
        .orderBy(desc(schema.adsConversionOutbox.createdAt))
        .limit(20),
      db
        .select({
          status: schema.adsConversionOutbox.status,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.adsConversionOutbox)
        .where(eq(schema.adsConversionOutbox.clinicId, clinic.id))
        .groupBy(schema.adsConversionOutbox.status),
      // P2-2: agent heartbeat snapshot. Single-row read; cheap.
      db
        .select()
        .from(schema.pvsAgentStatus)
        .where(eq(schema.pvsAgentStatus.clinicId, clinic.id))
        .limit(1),
      // P2-2: last 5 dead-letter prune roll-ups for the "Prune-Historie"
      // expander. 5 is enough to spot a pattern; more belongs in a
      // dedicated drill-down page if we ever need it.
      db
        .select({
          id: schema.pvsAgentFailureSummary.id,
          prunedCount: schema.pvsAgentFailureSummary.prunedCount,
          prunedOldestAt: schema.pvsAgentFailureSummary.prunedOldestAt,
          prunedNewestAt: schema.pvsAgentFailureSummary.prunedNewestAt,
          reasons: schema.pvsAgentFailureSummary.reasons,
          reportedAt: schema.pvsAgentFailureSummary.reportedAt,
        })
        .from(schema.pvsAgentFailureSummary)
        .where(eq(schema.pvsAgentFailureSummary.clinicId, clinic.id))
        .orderBy(desc(schema.pvsAgentFailureSummary.reportedAt))
        .limit(5),
    ]);
    const adsConversion = {
      pending: outboxCounts.find((r) => r.status === "pending")?.n ?? 0,
      sent: outboxCounts.find((r) => r.status === "sent")?.n ?? 0,
      skipped: outboxCounts.find((r) => r.status === "skipped")?.n ?? 0,
      failed: outboxCounts.find((r) => r.status === "failed")?.n ?? 0,
      recent: outboxRows,
    };
    const agent = agentStatusRow[0]
      ? {
          lastHeartbeatAt: agentStatusRow[0].lastHeartbeatAt,
          agentVersion: agentStatusRow[0].agentVersion,
          failedEvents: agentStatusRow[0].failedEvents,
          oldestFailedAt: agentStatusRow[0].oldestFailedAt,
          lastFailureReason: agentStatusRow[0].lastFailureReason,
          // 0069: liveness signals. failedEvents only counts dead rows, so
          // these are what tells "ruhige Woche" apart from "Installation
          // kaputt": ein steckengebliebenes Outbox-Backlog, ein verschobener
          // Export-Ordner, ein nie gestarteter Runner, ein toter Stream.
          pendingEvents: agentStatusRow[0].pendingEvents,
          stalePendingEvents: agentStatusRow[0].stalePendingEvents,
          oldestPendingAt: agentStatusRow[0].oldestPendingAt,
          missingFolders:
            (agentStatusRow[0].missingFolders as string[] | null) ?? [],
          dbAdaptersFailed: agentStatusRow[0].dbAdaptersFailed,
          adapterStatuses:
            (agentStatusRow[0].adapterStatuses as Array<{
              vendor: string;
              stream: string;
              status: string;
              lastError?: string | null;
              connectError?: string | null;
            }> | null) ?? [],
          recentReasons:
            (agentStatusRow[0].recentReasons as Array<{
              reason: string;
              count: number;
            }> | null) ?? [],
          recentPruneSummaries: agentFailurePrunes.map((p) => {
            const reasons =
              (p.reasons as Array<{ reason: string; count: number }> | null) ??
              [];
            return {
              id: p.id,
              prunedCount: p.prunedCount,
              prunedOldestAt: p.prunedOldestAt,
              prunedNewestAt: p.prunedNewestAt,
              topReason: reasons[0]?.reason ?? null,
              reportedAt: p.reportedAt,
            };
          }),
        }
      : null;
    renderedTab = (
      <IntegrationenTab
        creds={creds}
        syncHistory={syncEvents}
        adsConversion={adsConversion}
        agentStatus={agent}
      />
    );
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
              Praxen
            </Link>
            <span className="mx-1">/</span>
            <span className="font-mono">{clinic.slug}</span>
          </div>
          <h1 className="text-3xl font-semibold md:text-4xl">{clinic.displayName}</h1>
          <p className="text-lg text-fg-primary">{clinic.legalName}</p>
        </div>
        <div className="flex items-center gap-2">
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
