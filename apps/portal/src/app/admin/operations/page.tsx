import { desc, eq, ne } from "drizzle-orm";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import {
  inactiveTeamMembers,
  pendingOperationCounts,
  slaBreachQueue,
  stalledLeads,
  syncErrorList,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { SlaQueue } from "./_components/SlaQueue";
import { AnimationenQueue } from "./_components/AnimationenQueue";
import { SyncErrorsQueue } from "./_components/SyncErrorsQueue";
import { MfaMissingQueue } from "./_components/MfaMissingQueue";
import { StalledLeadsQueue } from "./_components/StalledLeadsQueue";
import { SectionRail } from "./_components/SectionRail";

export const metadata = { title: "Operations · Admin" };

export default async function AdminOperationsPage() {
  await requireAdmin();

  const [
    counts,
    sla,
    animations,
    syncs,
    mfa,
    stalled,
  ] = await Promise.all([
    pendingOperationCounts(),
    slaBreachQueue(30),
    db
      .select({
        id: schema.animationInstances.id,
        status: schema.animationInstances.status,
        requestedAt: schema.animationInstances.requestedAt,
        requestNote: schema.animationInstances.requestNote,
        storageKeyCustomized: schema.animationInstances.storageKeyCustomized,
        clinicId: schema.clinics.id,
        clinicName: schema.clinics.displayName,
        libraryTitle: schema.animationLibrary.title,
        libraryTreatment: schema.animationLibrary.treatmentTag,
        requesterName: schema.clinicUsers.fullName,
        requesterEmail: schema.clinicUsers.email,
      })
      .from(schema.animationInstances)
      .leftJoin(
        schema.clinics,
        eq(schema.clinics.id, schema.animationInstances.clinicId)
      )
      .leftJoin(
        schema.animationLibrary,
        eq(schema.animationLibrary.id, schema.animationInstances.libraryId)
      )
      .leftJoin(
        schema.clinicUsers,
        eq(schema.clinicUsers.id, schema.animationInstances.requestedBy)
      )
      .where(ne(schema.animationInstances.status, "ready"))
      .orderBy(desc(schema.animationInstances.requestedAt)),
    syncErrorList(),
    inactiveTeamMembers(),
    stalledLeads(30),
  ]);

  // Filter animations to only "open" states for the queue (not "standard" or "ready").
  const openAnimations = animations.filter(
    (a) => a.status === "requested" || a.status === "in_production"
  );

  const railItems = [
    { id: "sla", label: "SLA-Verstöße", count: counts.slaBreaches },
    {
      id: "animationen",
      label: "Animationen",
      count: counts.animationsRequested + counts.animationsInProduction,
    },
    { id: "sync-fehler", label: "Sync-Fehler", count: counts.syncErrors },
    { id: "mfa", label: "MFA fehlt", count: counts.mfaMissing },
    {
      id: "stagnierte",
      label: "Stagnierte Leads",
      count: counts.stalledRequests,
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Operations"
        subtitle="Alle offenen Aufgaben in einer Ansicht. Pro Sektion das Wichtigste oben."
      />

      <div className="flex gap-8">
        <SectionRail items={railItems} />
        <div className="min-w-0 flex-1 space-y-6">
          <SlaQueue rows={sla} />
          <AnimationenQueue rows={openAnimations} />
          <SyncErrorsQueue rows={syncs} />
          <MfaMissingQueue rows={mfa} />
          <StalledLeadsQueue rows={stalled} />
        </div>
      </div>
    </div>
  );
}
