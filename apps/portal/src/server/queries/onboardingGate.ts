import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  BLOCKER_CHECKLIST_IDS,
  REQUIRED_CHECKLIST_IDS,
  isDelivered,
  type ChecklistStatus,
} from "@/app/(portal)/onboarding/checkliste/content";

/**
 * Single source of truth for the onboarding access gate.
 *
 * An Inhaber is forced through onboarding before the data tabs unlock. The
 * gate is intentionally lighter than "the whole checklist": it clears once the
 * Discovery-Fragebogen is submitted AND the Praxis has delivered the handful of
 * Blocker checklist items (A1-A5). We count *clinic-side* delivery
 * (`geliefert`/`geprueft`/`entfaellt`), never EINS verification (`geprueft`
 * only) — otherwise the owner would sit locked out waiting on us. The longer
 * asset-delivery tail is nudged by a banner, not walled.
 *
 * Read via the superuser `db` (no clinic context) like the /onboarding hub —
 * these are owner-only reads on a single clinic id.
 */
export interface OnboardingGateStatus {
  fragebogenSubmitted: boolean;
  blockersDelivered: number;
  blockersTotal: number;
  requiredDelivered: number;
  requiredTotal: number;
  /** Fragebogen submitted + every Blocker item delivered → data tabs unlock. */
  gateComplete: boolean;
  /** Whole mandatory checklist delivered → the soft reminder banner stops. */
  checklistComplete: boolean;
}

export async function getOnboardingGateStatus(
  clinicId: string
): Promise<OnboardingGateStatus> {
  const [discoveryRow] = await db
    .select({ submittedAt: schema.discoveryFragebogen.submittedAt })
    .from(schema.discoveryFragebogen)
    .where(eq(schema.discoveryFragebogen.clinicId, clinicId))
    .limit(1);
  // "Ever submitted", not "currently eingereicht": an owner may reopen the
  // questionnaire to edit it (status flips back to entwurf) — that must NOT
  // re-close the gate and trap them back in onboarding.
  const fragebogenSubmitted = Boolean(discoveryRow?.submittedAt);

  const checklistRows = await db
    .select({
      itemId: schema.checklistItems.itemId,
      status: schema.checklistItems.status,
    })
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.clinicId, clinicId));
  const statusById = new Map(
    checklistRows.map((r) => [r.itemId, r.status as ChecklistStatus])
  );

  const blockersDelivered = BLOCKER_CHECKLIST_IDS.filter((id) =>
    isDelivered(statusById.get(id))
  ).length;
  const requiredDelivered = REQUIRED_CHECKLIST_IDS.filter((id) =>
    isDelivered(statusById.get(id))
  ).length;

  const gateComplete =
    fragebogenSubmitted && blockersDelivered >= BLOCKER_CHECKLIST_IDS.length;
  const checklistComplete = requiredDelivered >= REQUIRED_CHECKLIST_IDS.length;

  return {
    fragebogenSubmitted,
    blockersDelivered,
    blockersTotal: BLOCKER_CHECKLIST_IDS.length,
    requiredDelivered,
    requiredTotal: REQUIRED_CHECKLIST_IDS.length,
    gateComplete,
    checklistComplete,
  };
}

/** Paths an un-onboarded Inhaber may still reach while the gate is closed:
 *  the onboarding hub + its sub-pages, settings, and self-serve help. */
const GATE_ALLOWED_PREFIXES = [
  "/onboarding",
  "/einstellungen",
  "/faq",
  "/feedback",
];

export function isGateAllowedPath(pathname: string | null | undefined): boolean {
  // Unknown path (header missing) → never lock the user out.
  if (!pathname) return true;
  return GATE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}
