import "server-only";
import { desc, eq } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { DocumentKind } from "@/lib/constants";
import { documentVisibleToRole } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * List documents visible to the caller's role.
 * Visibility is enforced on top of RLS via the `visible_to_roles` array.
 */
export async function listDocuments(
  clinicId: string,
  userId: string,
  role: Role,
  options: { kind?: DocumentKind } = {}
) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await (options.kind
      ? tx
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.kind, options.kind))
          .orderBy(desc(schema.documents.createdAt))
      : tx
          .select()
          .from(schema.documents)
          .orderBy(desc(schema.documents.createdAt)));

    return rows.filter((d) =>
      documentVisibleToRole(d.visibleToRoles, role)
    );
  });
}
