import { cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listTreatments } from "@/server/queries/treatments";
import { AnfrageAnlegenHead } from "./_head";
import { ManualEntryForm } from "./_form";
import { PAGE_WIDTH, STACK } from "./_lib/sizes";

export const metadata = { title: "Anfrage anlegen" };

/** "Anfrage anlegen" for the Empfang: a person called the Praxis or walked in. */
export default async function AnfrageAnlegenPage() {
  const session = await requirePermissionOrRedirect("requests.update");
  const treatments = (await listTreatments(session.clinicId, session.userId))
    .filter((t) => t.isActive)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className={cn(PAGE_WIDTH, STACK)}>
      <AnfrageAnlegenHead />
      <ManualEntryForm treatments={treatments} />
    </div>
  );
}
