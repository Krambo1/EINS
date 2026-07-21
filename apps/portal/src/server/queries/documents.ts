import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/constants";
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
 * The distinct document kinds that are actually visible to this role, in the
 * canonical DOCUMENT_KINDS order. Drives the Dokumentart filter chips so a role
 * never sees a chip (e.g. "Vertrag") whose filtered view would be empty because
 * every document of that kind is hidden from it by `visible_to_roles`.
 */
export async function listVisibleDocumentKinds(
  clinicId: string,
  userId: string,
  role: Role
): Promise<DocumentKind[]> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const rows = await tx
        .select({
          kind: schema.documents.kind,
          visibleToRoles: schema.documents.visibleToRoles,
        })
        .from(schema.documents);

      const present = new Set<string>();
      for (const r of rows) {
        if (documentVisibleToRole(r.visibleToRoles, role)) present.add(r.kind);
      }
      return DOCUMENT_KINDS.filter((k) => present.has(k));
    },
    "documents:visible-kinds"
  );
}

/**
 * Look up the single document row that owns a given storage key, scoped to the
 * caller's clinic. Returns null when no document references that key, i.e. the
 * key belongs to a non-document file class (clinic uploads, animation library,
 * avatars). Used by the local file-serving route to enforce per-document role
 * visibility on top of tenancy, so a non-owner who learns a contract's storage
 * key cannot fetch the file.
 */
export async function documentByStorageKey(
  clinicId: string,
  userId: string,
  storageKey: string
): Promise<{ visibleToRoles: string[] } | null> {
  const rows = await withClinicContext(
    clinicId,
    userId,
    (tx) =>
      tx
        .select({ visibleToRoles: schema.documents.visibleToRoles })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.clinicId, clinicId),
            eq(schema.documents.storageKey, storageKey)
          )
        )
        .limit(1),
    "documents:by-storage-key"
  );
  return rows[0] ?? null;
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
