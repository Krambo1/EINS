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
            className="text-muted-foreground hover:underline"
          >
            ← Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">PVS-Standorte zuordnen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Standort-IDs aus Ihrer PVS müssen einmalig EINS-Standorten zugeordnet
          werden, damit die Standort-Attribution stimmt.
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
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">PVS-Standort-ID</th>
                  <th className="p-3">PVS-Bezeichnung</th>
                  <th className="p-3">EINS-Standort</th>
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
