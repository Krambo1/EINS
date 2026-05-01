import {
  Card,
  CardContent,
  Input,
  Button,
  Badge,
  MetricTile,
} from "@eins/ui";
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
import { formatEuro, formatNumber } from "@/lib/formatting";
import {
  globalLeads,
  type AdminLeadFilters,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { LeadsTable } from "../_components/LeadsTable";

export const metadata = { title: "Leads · Admin" };

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";
const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
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

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const filters: AdminLeadFilters = {
    clinicIds: asArray(searchParams.clinicId).filter(Boolean),
    status: asArray(searchParams.status).filter((s) =>
      (REQUEST_STATUSES as readonly string[]).includes(s)
    ) as RequestStatus[],
    source: asArray(searchParams.source).filter((s) =>
      (REQUEST_SOURCES as readonly string[]).includes(s as RequestSource)
    ),
    aiCategory: asArray(searchParams.aiCategory).filter((c) =>
      ["hot", "warm", "cold", "unscored"].includes(c)
    ) as ("hot" | "warm" | "cold" | "unscored")[],
    fromDate: parseDate(
      typeof searchParams.from === "string" ? searchParams.from : undefined
    ),
    toDate: parseDate(
      typeof searchParams.to === "string" ? searchParams.to : undefined
    ),
    slaBreachedOnly: searchParams.slaBreachedOnly === "1",
    search:
      typeof searchParams.search === "string" && searchParams.search.length
        ? searchParams.search
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

  const qWithoutPage = { ...searchParams } as Record<
    string,
    string | string[] | undefined
  >;
  delete qWithoutPage.page;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Lead-Postfach"
        subtitle="Alle Anfragen aller Kliniken in einer Ansicht. Lesemodus — zum Bearbeiten in die jeweilige Klinik wechseln."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Anfragen"
          value={formatNumber(result.aggregates.total)}
          sublabel="im aktuellen Filter"
        />
        <MetricTile
          label="Qualifiziert"
          value={formatNumber(result.aggregates.qualified)}
          sublabel="≥ qualifiziert"
        />
        <MetricTile
          label="Gewonnen"
          value={formatNumber(result.aggregates.won)}
          sublabel="Cases"
          tone="accent"
        />
        <MetricTile
          label="Umsatz"
          value={formatEuro(result.aggregates.revenueEur)}
          sublabel="zugeordnet"
          tone="accent"
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="pt-6">
          <form
            className="grid gap-3 md:grid-cols-[2fr_repeat(4,1fr)_auto]"
            method="get"
          >
            <Input
              name="search"
              placeholder="Name, E-Mail, Telefon, Behandlungswunsch"
              defaultValue={filters.search ?? ""}
            />
            <select
              name="clinicId"
              multiple
              defaultValue={filters.clinicIds ?? []}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
              size={3}
            >
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              name="status"
              multiple
              defaultValue={filters.status ?? []}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
              size={3}
            >
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              name="source"
              multiple
              defaultValue={filters.source ?? []}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
              size={3}
            >
              {REQUEST_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              name="aiCategory"
              multiple
              defaultValue={filters.aiCategory ?? []}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
              size={3}
            >
              {AI_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {AI_CATEGORY_LABELS[c]}
                </option>
              ))}
              <option value="unscored">Ungescort</option>
            </select>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  name="slaBreachedOnly"
                  value="1"
                  defaultChecked={filters.slaBreachedOnly}
                />
                SLA verletzt
              </label>
              <Button type="submit" size="sm">
                Filtern
              </Button>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            <span>Aktive Filter:</span>
            {!hasFilters(filters) && <Badge tone="neutral">Keine</Badge>}
            {filters.clinicIds && filters.clinicIds.length > 0 && (
              <Badge tone="neutral">
                {filters.clinicIds.length} Klinik
                {filters.clinicIds.length === 1 ? "" : "en"}
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
