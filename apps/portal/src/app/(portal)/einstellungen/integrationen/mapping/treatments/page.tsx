import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">PVS-Behandlungen zuordnen</h1>
        <p className="mt-1 text-base text-fg-primary">
          Ihre Praxis-Software (PVS) führt Behandlungen unter eigenen Kürzeln.
          Ordnen Sie jedes Kürzel einmal einer Behandlung im Portal zu, dann
          stimmen die Zahlen je Behandlung in Ihrer Auswertung.
        </p>
      </header>

      {mappings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Noch keine PVS-Behandlungen</CardTitle>
            <CardDescription>
              Sobald die ersten Termine oder Behandlungen aus Ihrer PVS ankommen,
              erscheinen die zugehörigen Kürzel hier.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary text-left text-sm font-medium text-fg-primary">
                <tr>
                  <th className="hidden p-3 sm:table-cell">Kürzel aus Ihrer Praxissoftware</th>
                  <th className="p-3">Name in Ihrer Praxissoftware</th>
                  <th className="p-3">Behandlung im Portal</th>
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
