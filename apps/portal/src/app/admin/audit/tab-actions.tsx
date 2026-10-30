"use server";

import { requireAdmin } from "@/auth/admin-guards";
import { auditOverview } from "@/server/queries/admin";
import { AuditOverviewPanel } from "./_components/AuditOverview";
import { AuditProtokoll } from "./_components/AuditProtokoll";

/** One tab of /admin/audit without filters, for the kept views of ParamViews. */
export async function loadAuditTab(value: string) {
  await requireAdmin();
  return value === "protokoll" ? (
    <AuditProtokoll searchParams={{ tab: "protokoll" }} />
  ) : (
    <AuditOverviewPanel data={await auditOverview(30)} />
  );
}
