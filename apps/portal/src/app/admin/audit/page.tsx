import Link from "next/link";
import { and, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import {
  Card,
  CardContent,
  Badge,
  Input,
  Button,
} from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { formatDateTime } from "@/lib/formatting";
import { auditOverview } from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AuditTabsNav } from "./_components/AuditTabsNav";
import { AuditOverviewPanel } from "./_components/AuditOverview";

export const metadata = { title: "Audit-Log" };

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

const TABS = [
  { key: "uebersicht", label: "Übersicht" },
  { key: "protokoll", label: "Protokoll" },
] as const;

interface PageProps {
  searchParams: {
    tab?: string;
    clinicId?: string;
    actor?: string;
    action?: string;
    entity?: string;
    page?: string;
  };
}

const PAGE_SIZE = 100;

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireAdmin();
  const tab = TABS.find((t) => t.key === searchParams.tab)?.key ?? "uebersicht";

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Audit-Log"
        subtitle="Vollständiges, append-only Protokoll. Übersicht zeigt Verteilung, Protokoll filtert."
      />

      <div className="border-y border-border py-2">
        <AuditTabsNav tabs={[...TABS]} current={tab} />
      </div>

      {tab === "uebersicht" ? (
        <AuditOverviewPanel data={await auditOverview(30)} />
      ) : (
        <AuditProtokoll searchParams={searchParams} />
      )}
    </div>
  );
}

async function AuditProtokoll({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions: SQL[] = [];
  if (searchParams.clinicId) {
    conditions.push(eq(schema.auditLog.clinicId, searchParams.clinicId));
  }
  if (searchParams.actor) {
    conditions.push(ilike(schema.auditLog.actorEmail, `%${searchParams.actor}%`));
  }
  if (searchParams.action) {
    conditions.push(eq(schema.auditLog.action, searchParams.action));
  }
  if (searchParams.entity) {
    conditions.push(eq(schema.auditLog.entityKind, searchParams.entity));
  }
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.auditLog.id,
        createdAt: schema.auditLog.createdAt,
        clinicId: schema.auditLog.clinicId,
        clinicName: schema.clinics.displayName,
        actorEmail: schema.auditLog.actorEmail,
        action: schema.auditLog.action,
        entityKind: schema.auditLog.entityKind,
        entityId: schema.auditLog.entityId,
        ipAddress: schema.auditLog.ipAddress,
        diff: schema.auditLog.diff,
      })
      .from(schema.auditLog)
      .leftJoin(
        schema.clinics,
        eq(schema.clinics.id, schema.auditLog.clinicId)
      )
      .where(whereExpr)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .where(whereExpr),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <Card className={GLOW_CARD}>
        <CardContent className="pt-6">
          <form className="grid gap-3 md:grid-cols-5" method="get">
            <input type="hidden" name="tab" value="protokoll" />
            <Input
              name="clinicId"
              placeholder="Klinik-ID (UUID)"
              defaultValue={searchParams.clinicId ?? ""}
            />
            <Input
              name="actor"
              placeholder="Akteur (E-Mail enthält)"
              defaultValue={searchParams.actor ?? ""}
            />
            <Input
              name="action"
              placeholder="Aktion (z.B. update)"
              defaultValue={searchParams.action ?? ""}
            />
            <Input
              name="entity"
              placeholder="Entität (z.B. request)"
              defaultValue={searchParams.entity ?? ""}
            />
            <Button type="submit">Filtern</Button>
          </form>
        </CardContent>
      </Card>

      <Card className={`${GLOW_CARD} !p-0 overflow-hidden`}>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg-secondary/40 text-left text-xs text-fg-secondary">
              <tr>
                <th className="px-4 py-2">Zeit</th>
                <th className="px-4 py-2">Klinik</th>
                <th className="px-4 py-2">Akteur</th>
                <th className="px-4 py-2">Aktion</th>
                <th className="px-4 py-2">Entität</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border align-top last:border-b-0"
                >
                  <td className="px-4 py-2 whitespace-nowrap text-xs">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.clinicId ? (
                      <Link
                        href={`/admin/clinics/${r.clinicId}`}
                        className="hover:text-accent"
                      >
                        {r.clinicName ?? r.clinicId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-fg-secondary">global</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.actorEmail ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone="neutral">{r.action}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.entityKind ?? "—"}
                    {r.entityId && (
                      <div className="font-mono text-[10px] text-fg-secondary">
                        {r.entityId.slice(0, 8)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.diff ? (
                      <pre className="max-w-md overflow-x-auto rounded bg-bg-secondary/60 p-2 font-mono text-[10px]">
                        {JSON.stringify(r.diff, null, 0)}
                      </pre>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-fg-secondary"
                  >
                    Keine Einträge für diesen Filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <div className="text-fg-secondary">
            Seite {page} von {totalPages}
          </div>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={{
                  pathname: "/admin/audit",
                  query: { ...searchParams, page: page - 1 },
                }}
                className="rounded-md border border-border px-3 py-1 hover:bg-bg-secondary"
              >
                Zurück
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={{
                  pathname: "/admin/audit",
                  query: { ...searchParams, page: page + 1 },
                }}
                className="rounded-md border border-border px-3 py-1 hover:bg-bg-secondary"
              >
                Weiter
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
