import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { cacheClinicQuery } from "./_cache";

export interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  isPrimary: boolean;
  displayOrder: number;
}

async function listLocationsUncached(
  clinicId: string,
  userId: string
): Promise<LocationRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    return await tx
      .select({
        id: schema.locations.id,
        name: schema.locations.name,
        address: schema.locations.address,
        isPrimary: schema.locations.isPrimary,
        displayOrder: schema.locations.displayOrder,
      })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.clinicId, clinicId),
          isNull(schema.locations.archivedAt)
        )
      )
      .orderBy(asc(schema.locations.displayOrder), asc(schema.locations.name));
  });
}

export const listLocations = cacheClinicQuery(
  "listLocations",
  listLocationsUncached,
  {}
);
