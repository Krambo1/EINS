import { requireAdmin } from "@/auth/admin-guards";
import { auditOverview } from "@/server/queries/admin";
import { ParamViews, ParamViewsSlot } from "@/app/_components/instant-views";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AuditTabsNav } from "./_components/AuditTabsNav";
import { AuditOverviewPanel } from "./_components/AuditOverview";
import { AuditProtokoll, type AuditSearchParams } from "./_components/AuditProtokoll";
import { AUDIT_TABS } from "./_components/audit-tabs";
import { loadAuditTab } from "./tab-actions";

export const metadata = { title: "Audit-Log" };

interface PageProps {
  searchParams: Promise<AuditSearchParams>;
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const tab = AUDIT_TABS.find((t) => t.key === params.tab)?.key ?? "uebersicht";

  // The two tabs are kept views: a switch swaps them without a navigation.
  return (
    <ParamViews
      param="tab"
      values={AUDIT_TABS.map((t) => t.key)}
      defaultValue="uebersicht"
      load={loadAuditTab}
      only
    >
      <div className="space-y-8">
        <AdminPageHeader
          title="Audit-Log"
          subtitle="Vollständiges, append-only Protokoll. Übersicht zeigt Verteilung, Protokoll filtert."
        />

        <div className="border-y border-border py-2">
          <AuditTabsNav tabs={[...AUDIT_TABS]} />
        </div>

        <ParamViewsSlot param="tab" value={tab}>
          {tab === "uebersicht" ? (
            <AuditOverviewPanel data={await auditOverview(30)} />
          ) : (
            <AuditProtokoll searchParams={params} />
          )}
        </ParamViewsSlot>
      </div>
    </ParamViews>
  );
}
