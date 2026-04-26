import { Card, CardContent, Input, Button, Badge } from "@eins/ui";
import {
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  REQUEST_SOURCES,
  SOURCE_LABELS,
  AI_CATEGORIES,
  AI_CATEGORY_LABELS,
} from "@/lib/constants";
import type { AdminLeadFilters, AdminLeadRow } from "@/server/queries/admin";
import { LeadsTable } from "../../../_components/LeadsTable";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";
const PAGE_SIZE = 50;

interface Props {
  rows: AdminLeadRow[];
  total: number;
  aggregates: { total: number; qualified: number; won: number; revenueEur: number };
  page: number;
  filters: AdminLeadFilters;
  searchParams: Record<string, string | string[] | undefined>;
  clinicId: string;
}

export function LeadsTab({
  rows,
  total,
  page,
  filters,
  searchParams,
  clinicId,
}: Props) {
  const qWithoutPage = { ...searchParams } as Record<
    string,
    string | string[] | undefined
  >;
  delete qWithoutPage.page;

  return (
    <div className="space-y-5">
      <Card className={GLOW_CARD}>
        <CardContent className="pt-6">
          <form className="grid gap-3 md:grid-cols-[2fr_repeat(3,1fr)_auto]" method="get">
            <input type="hidden" name="tab" value="leads" />
            <Input
              name="search"
              placeholder="Suche: Name, E-Mail, Telefon, Wunsch"
              defaultValue={filters.search ?? ""}
            />
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
            {filters.slaBreachedOnly && (
              <Badge tone="bad">SLA verletzt</Badge>
            )}
            {filters.search && (
              <Badge tone="neutral">Suche: {filters.search}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <LeadsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath={`/admin/clinics/${clinicId}`}
        queryWithoutPage={qWithoutPage}
        hideClinic
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
    !!f.aiCategory?.length
  );
}
