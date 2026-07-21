import { Card, CardContent } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { listDefaultJourneySteps } from "@/server/timeline-journey";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { JourneyTemplateEditor } from "./_components/JourneyTemplateEditor";

export const metadata = { title: "Standard-Journey · Admin" };

export default async function AdminJourneyPage() {
  await requireAdmin();

  const steps = await listDefaultJourneySteps();
  const activeCount = steps.filter((s) => s.isActive).length;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Standard-Journey"
        subtitle="Der Standard-Fahrplan, den jede neue Praxis im Fortschritt-Tab sieht: vom Auftakt bis zum 90-Tage-Gespräch. So weiß der Inhaber ab Tag eins, was kommt."
      />

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm text-fg-secondary">
          <p>
            Diese Vorlage wird in jede Praxis kopiert, sobald sie angelegt oder
            über „Standard-Journey einsetzen“ befüllt wird. Aktiv:{" "}
            <span className="font-medium text-fg-primary tabular-nums">
              {activeCount}
            </span>{" "}
            von{" "}
            <span className="tabular-nums">{steps.length}</span> Schritten.
          </p>
          <p>
            Änderungen hier gelten nur für künftige Einsetzungen. Bereits
            befüllte Praxen behalten ihre Schritte und werden pro Praxis im
            jeweiligen Fortschritt-Tab angepasst.
          </p>
        </CardContent>
      </Card>

      <JourneyTemplateEditor steps={steps} />
    </div>
  );
}
