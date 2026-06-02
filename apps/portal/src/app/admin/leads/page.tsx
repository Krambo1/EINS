import { Card, CardContent, Badge, MetricTile } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { asc, isNull } from "drizzle-orm";
import {
  AI_CATEGORIES,
  AI_CATEGORY_LABELS,
  REQUEST_SOURCES,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  type RequestSource,
  type RequestStatus,
} from "@/lib/constants";
import { formatClinicAggregate, formatNumber } from "@/lib/formatting";
import {
  globalLeads,
  type AdminLeadFilters,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { LeadsTable } from "../_components/LeadsTable";
import {
  AdminSearchInput,
  AdminUrlMultiSelect,
  AdminUrlToggle,
} from "../_components/AdminFilters";

export const metadata = { title: "Leads · Admin" };

const GLOW_CARD = "!bg-bg-secondary";
const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function AdminLeadsPage({ searchParams }: PageProps) {
  await requireAdmin();

  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const filters: AdminLeadFilters = {
    clinicIds: asArray(params.clinicId).filter(Boolean),
    status: asArray(params.status).filter((s) =>
      (REQUEST_STATUSES as readonly string[]).includes(s)
    ) as RequestStatus[],
    source: asArray(params.source).filter((s) =>
      (REQUEST_SOURCES as readonly string[]).includes(s as RequestSource)
    ),
    aiCategory: asArray(params.aiCategory).filter((c) =>
      ["hot", "warm", "cold", "unscored"].includes(c)
    ) as ("hot" | "warm" | "cold" | "unscored")[],
    fromDate: parseDate(
      typeof params.from === "string" ? params.from : undefined
    ),
    toDate: parseDate(
      typeof params.to === "string" ? params.to : undefined
    ),
    slaBreachedOnly: params.slaBreachedOnly === "1",
    search:
      typeof params.search === "string" && params.search.length
        ? params.search
        : undefined,
  };

  const [clinics, result] = await Promise.all([
    db
      .select({
        id: schema.clinics.id,
        name: schema.clinics.displayName,
      })
      .from(schema.clinics)
      .where(isNull(schema.clinics.archivedAt))
      .orderBy(asc(schema.clinics.displayName)),
    globalLeads(filters, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const qWithoutPage = { ...params } as Record<
    string,
    string | string[] | undefined
  >;
  delete qWithoutPage.page;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Lead-Postfach"
        subtitle="Alle Anfragen aller Praxen in einer Ansicht. Lesemodus — zum Bearbeiten in die jeweilige Praxis wechseln."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Anfragen"
          value={formatNumber(result.aggregates.total)}
          sublabel="im aktuellen Filter"
        />
        <MetricTile
          label="Im Funnel"
          value={formatNumber(result.aggregates.inFunnel)}
          sublabel="Termin vereinbart oder weiter"
        />
        <MetricTile
          label="Gewonnen"
          value={formatNumber(result.aggregates.won)}
          sublabel="Cases"
          tone="accent"
        />
        <MetricTile
          label="Umsatz"
          value={formatClinicAggregate(
            result.aggregates.revenueEur,
            result.aggregates.currencies
          )}
          sublabel="zugeordnet"
          tone="accent"
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="pt-6">
          <div className="grid gap-3 md:grid-cols-[2fr_repeat(4,1fr)_auto]">
            <AdminSearchInput placeholder="Name, E-Mail, Telefon, Behandlungswunsch" />
            <AdminUrlMultiSelect
              param="clinicId"
              selected={filters.clinicIds ?? []}
              label="Praxis"
              options={clinics.map((c) => ({ value: c.id, label: c.name }))}
            />
            <AdminUrlMultiSelect
              param="status"
              selected={filters.status ?? []}
              label="Status"
              options={REQUEST_STATUSES.map((s) => ({
                value: s,
                label: REQUEST_STATUS_LABELS[s],
              }))}
            />
            <AdminUrlMultiSelect
              param="source"
              selected={filters.source ?? []}
              label="Quelle"
              options={REQUEST_SOURCES.map((s) => ({
                value: s,
                label: SOURCE_LABELS[s],
              }))}
            />
            <AdminUrlMultiSelect
              param="aiCategory"
              selected={filters.aiCategory ?? []}
              label="KI-Bewertung"
              options={[
                ...AI_CATEGORIES.map((c) => ({
                  value: c,
                  label: AI_CATEGORY_LABELS[c],
                })),
                { value: "unscored", label: "Ungescort" },
              ]}
            />
            <AdminUrlToggle
              param="slaBreachedOnly"
              checked={!!filters.slaBreachedOnly}
              label="SLA verletzt"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            <span>Aktive Filter:</span>
            {!hasFilters(filters) && <Badge tone="neutral">Keine</Badge>}
            {filters.clinicIds && filters.clinicIds.length > 0 && (
              <Badge tone="neutral">
                {filters.clinicIds.length}{" "}
                {filters.clinicIds.length === 1 ? "Praxis" : "Praxen"}
              </Badge>
            )}
            {filters.status?.map((s) => (
              <Badge key={`s-${s}`} tone="neutral">
                Status: {REQUEST_STATUS_LABELS[s]}
              </Badge>
            ))}
            {filters.source?.map((s) => (
              <Badge key={`src-${s}`} tone="neutral">
                Quelle: {s}
              </Badge>
            ))}
            {filters.slaBreachedOnly && <Badge tone="bad">SLA verletzt</Badge>}
            {filters.search && (
              <Badge tone="neutral">Suche: {filters.search}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <LeadsTable
        rows={result.items}
        total={result.total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/admin/leads"
        queryWithoutPage={qWithoutPage}
      />
    </div>
  );
}

function hasFilters(f: AdminLeadFilters): boolean {
  return (
    !!f.search ||
    !!f.slaBreachedOnly ||
    !!f.status?.length ||
    !!f.source?.length ||
    !!f.aiCategory?.length ||
    !!f.clinicIds?.length ||
    !!f.fromDate ||
    !!f.toDate
  );
}
