import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Card, CardContent, Badge, Input, Button } from "@eins/ui";
import { db, schema } from "@/db/client";
import { formatDateTime } from "@/lib/formatting";
import { escapeLike } from "@/server/queries/admin";
import { isUuid } from "@/lib/ids";
import { NavForm, NavTransition, PendingDim, PendingLink } from "@/app/_components/instant-views";

export type AuditSearchParams = {
  tab?: string;
  clinicId?: string;
  actor?: string;
  action?: string;
  entity?: string;
  page?: string;
};

const PAGE_SIZE = 100;
/** Admin-only trails written WITHOUT clinic_id on purpose (the Praxis must not
 *  see them); the clinic id sits in entity_id instead (G-16). */
const CLINIC_IN_ENTITY_ID = ["guarantee_clock", "response_enforcement"];

/**
 * The Protokoll tab of /admin/audit. Filters and pages stay on the server
 * (the log is unbounded); the form and the pager navigate in a transition,
 * so the rows dim at once at the same size (instant-views.tsx).
 */
export async function AuditProtokoll({
  searchParams,
}: {
  searchParams: AuditSearchParams;
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions: SQL[] = [];
  const clinicId =
    searchParams.clinicId && isUuid(searchParams.clinicId)
      ? searchParams.clinicId
      : null;
  if (clinicId) {
    conditions.push(
      or(
        eq(schema.auditLog.clinicId, clinicId),
        and(
          isNull(schema.auditLog.clinicId),
          eq(schema.auditLog.entityId, clinicId),
          inArray(schema.auditLog.entityKind, CLINIC_IN_ENTITY_ID)
        )
      )!
    );
  }
  if (searchParams.actor) {
    conditions.push(ilike(schema.auditLog.actorEmail, `%${escapeLike(searchParams.actor)}%`));
  }
  if (searchParams.action) {
    conditions.push(eq(schema.auditLog.action, searchParams.action));
  }
  if (searchParams.entity) {
    conditions.push(eq(schema.auditLog.entityKind, searchParams.entity));
  }
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const [clinicOptions, rows, [{ total }]] = await Promise.all([
    db
      .select({ id: schema.clinics.id, name: schema.clinics.displayName })
      .from(schema.clinics)
      .orderBy(asc(schema.clinics.displayName)),
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
        impersonatedByAdminId: schema.auditLog.impersonatedByAdminId,
        impersonatedByAdminEmail: schema.adminUsers.email,
      })
      .from(schema.auditLog)
      .leftJoin(
        schema.clinics,
        eq(schema.clinics.id, schema.auditLog.clinicId)
      )
      .leftJoin(
        schema.adminUsers,
        eq(schema.adminUsers.id, schema.auditLog.impersonatedByAdminId)
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
    <NavTransition>
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <NavForm className="grid gap-3 md:grid-cols-5">
            <input type="hidden" name="tab" value="protokoll" />
            <select
              name="clinicId"
              aria-label="Praxis"
              defaultValue={clinicId ?? ""}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm"
            >
              <option value="">Alle Praxen</option>
              {clinicOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
          </NavForm>
        </CardContent>
      </Card>

      <PendingDim>
      <Card className="!p-0 overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg-secondary text-left text-xs font-medium text-fg-secondary">
              <tr>
                <th className="px-4 py-2">Zeit</th>
                <th className="px-4 py-2">Praxis</th>
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
                    {r.actorEmail ?? "–"}
                    {r.impersonatedByAdminId && (
                      <div className="font-sans text-fg-secondary">
                        durch Admin
                        {r.impersonatedByAdminEmail ? ` ${r.impersonatedByAdminEmail}` : ""} in
                        Kundenansicht
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone="neutral">{r.action}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.entityKind ?? "–"}
                    {r.entityId && (
                      <div className="font-mono text-[10px] text-fg-secondary">
                        {r.entityId.slice(0, 8)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.diff ? (
                      <pre className="max-w-md overflow-x-auto rounded bg-bg-secondary p-2 font-mono text-[10px]">
                        {JSON.stringify(r.diff, null, 0)}
                      </pre>
                    ) : (
                      "–"
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
      </PendingDim>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <div className="text-fg-secondary">
            Seite {page} von {totalPages}
          </div>
          {/* Both on every page, greyed out at the ends, so neither moves. */}
          <div className="flex gap-2">
            <PagerLink href={pageHref(searchParams, page - 1)} disabled={page <= 1}>
              Zurück
            </PagerLink>
            <PagerLink href={pageHref(searchParams, page + 1)} disabled={page >= totalPages}>
              Weiter
            </PagerLink>
          </div>
        </nav>
      )}
    </div>
    </NavTransition>
  );
}

function pageHref(searchParams: AuditSearchParams, page: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string" && v !== "" && k !== "page") q.set(k, v);
  }
  if (page > 1) q.set("page", String(page));
  return `/admin/audit?${q.toString()}`;
}

function PagerLink({ href, disabled, children }: { href: string; disabled: boolean; children: ReactNode }) {
  const cls = "rounded-md border border-border px-3 py-1";
  if (disabled) {
    return (
      <span aria-disabled className={`${cls} text-fg-tertiary`}>
        {children}
      </span>
    );
  }
  return (
    <PendingLink href={href} className={`${cls} hover:bg-bg-secondary`}>
      {children}
    </PendingLink>
  );
}
