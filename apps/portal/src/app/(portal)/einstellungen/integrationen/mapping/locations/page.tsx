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
import { LocationMappingRow } from "./_mapping-row";

export const metadata = { title: "PVS-Standorte zuordnen" };

export default async function LocationsMappingPage() {
  const session = await requireSession();

  const mappings = await db
    .select({
      id: schema.pvsLocationMapping.id,
      pvsLocationId: schema.pvsLocationMapping.pvsLocationId,
      pvsLabel: schema.pvsLocationMapping.pvsLabel,
      portalLocationId: schema.pvsLocationMapping.portalLocationId,
      status: schema.pvsLocationMapping.status,
    })
    .from(schema.pvsLocationMapping)
    .where(eq(schema.pvsLocationMapping.clinicId, session.clinicId))
    .orderBy(schema.pvsLocationMapping.status, schema.pvsLocationMapping.pvsLabel);

  const locations = await db
    .select({
      id: schema.locations.id,
      name: schema.locations.name,
    })
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.clinicId, session.clinicId),
        isNull(schema.locations.archivedAt)
      )
    )
    .orderBy(schema.locations.displayOrder);

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
        <h1 className="text-2xl font-semibold">PVS-Standorte zuordnen</h1>
        <p className="mt-1 text-base text-fg-primary">
          Ihre Praxis-Software (PVS) nennt Standorte mit eigenen Nummern.
          Ordnen Sie jede Nummer einmal einem Standort im Portal zu, dann
          stimmen die Zahlen je Standort.
        </p>
      </header>

      {mappings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Noch keine PVS-Standorte</CardTitle>
            <CardDescription>
              Sobald die ersten Termine aus Ihrer PVS mit Standort-Info ankommen,
              erscheinen sie hier.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary text-left text-sm font-medium text-fg-primary">
                <tr>
                  <th className="hidden p-3 sm:table-cell">Nummer aus Ihrer Praxissoftware</th>
                  <th className="p-3">Name in Ihrer Praxissoftware</th>
                  <th className="p-3">Standort im Portal</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <LocationMappingRow
                    key={m.id}
                    mappingId={m.id}
                    pvsId={m.pvsLocationId}
                    pvsLabel={m.pvsLabel}
                    currentPortalId={m.portalLocationId}
                    status={m.status as "unmapped" | "mapped" | "ignored"}
                    locations={locations}
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
