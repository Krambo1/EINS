import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { DocumentKind } from "@/lib/constants";
import { documentVisibleToRole } from "@/lib/roles";
import type { Role } from "@/lib/constants";
import { sectionBadgeThreshold } from "./navBadges";

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

/**
 * Returns true iff any document visible to this role has been added since
 * this user's last visit to /dokumente. Drives the sidebar Dokumente "Neu"
 * pill. Role-filtered so a marketing user doesn't see a badge for an
 * inhaber-only contract they couldn't open anyway.
 */
export async function hasNewDocuments(
  clinicId: string,
  userId: string,
  role: Role
): Promise<boolean> {
  const threshold = await sectionBadgeThreshold(clinicId, userId, "dokumente");
  const rows = await withClinicContext(
    clinicId,
    userId,
    (tx) =>
      tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.clinicId, clinicId),
            gt(schema.documents.createdAt, threshold),
            // visible_to_roles is a NOT NULL text[]; the schema default
            // includes 'inhaber','marketing' so the array is never empty
            // in practice. Plain `= ANY` handles every realistic row.
            sql`${role} = ANY(${schema.documents.visibleToRoles})`
          )
        )
        .limit(1),
    "documents:has-new"
  );
  return rows.length > 0;
}
