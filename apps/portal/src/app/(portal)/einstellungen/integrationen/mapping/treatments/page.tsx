import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { MappingRow } from "./_mapping-row";

export const metadata = { title: "PVS-Behandlungen zuordnen" };

export default async function TreatmentsMappingPage() {
  const session = await requireSession();

  const mappings = await db
    .select({
      id: schema.pvsTreatmentMapping.id,
      pvsTreatmentCode: schema.pvsTreatmentMapping.pvsTreatmentCode,
      pvsLabel: schema.pvsTreatmentMapping.pvsLabel,
      portalTreatmentId: schema.pvsTreatmentMapping.portalTreatmentId,
      suggestedTreatmentId: schema.pvsTreatmentMapping.suggestedTreatmentId,
      status: schema.pvsTreatmentMapping.status,
    })
    .from(schema.pvsTreatmentMapping)
    .where(eq(schema.pvsTreatmentMapping.clinicId, session.clinicId))
    .orderBy(schema.pvsTreatmentMapping.status, schema.pvsTreatmentMapping.pvsLabel);

  const treatments = await db
    .select({
      id: schema.treatments.id,
      name: schema.treatments.name,
    })
    .from(schema.treatments)
    .where(
      and(
        eq(schema.treatments.clinicId, session.clinicId),
        isNull(schema.treatments.archivedAt)
      )
    )
    .orderBy(schema.treatments.displayOrder);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen/integrationen"
            className="text-muted-foreground hover:underline"
          >
            ← Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">PVS-Behandlungen zuordnen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Behandlungs-Codes aus Ihrer PVS müssen einmalig EINS-Behandlungen
          zugeordnet werden, damit die Behandlungs-Attribution in den KPIs stimmt.
        </p>
      </header>

      {mappings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Noch keine PVS-Behandlungen</CardTitle>
            <CardDescription>
              Sobald die ersten Termine oder Behandlungen aus Ihrer PVS ankommen,
              erscheinen die zugehörigen Codes hier.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">PVS-Code</th>
                  <th className="p-3">PVS-Bezeichnung</th>
                  <th className="p-3">EINS-Behandlung</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <MappingRow
                    key={m.id}
                    mappingId={m.id}
                    pvsCode={m.pvsTreatmentCode}
                    pvsLabel={m.pvsLabel}
                    currentPortalId={m.portalTreatmentId}
                    suggestedId={m.suggestedTreatmentId}
                    status={m.status as "unmapped" | "mapped" | "ignored"}
                    treatments={treatments}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
