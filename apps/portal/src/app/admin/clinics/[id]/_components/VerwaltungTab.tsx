import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@eins/ui";
import { PendingSubmitButton } from "../../../_components/PendingSubmitButton";
import { DangerSubmitButton } from "../../../_components/DangerSubmitButton";
import { formatDateTime } from "@/lib/formatting";
import type { schema } from "@/db/client";
import {
  archiveClinicAction,
  unarchiveClinicAction,
} from "../actions";

export function VerwaltungTab({
  clinic,
}: {
  clinic: typeof schema.clinics.$inferSelect;
}) {
  const isArchived = clinic.archivedAt !== null;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Praxis-Status</CardTitle>
          <CardDescription>
            Archivieren sperrt alle Zugänge der Praxis und meldet angemeldete
            Personen ab. Die Daten bleiben in der Datenbank. Der Vorgang ist
            umkehrbar: Reaktivieren gibt die gesperrten Zugänge wieder frei.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isArchived ? (
              <form action={unarchiveClinicAction}>
                <input type="hidden" name="id" value={clinic.id} />
                <PendingSubmitButton
                  variant="outline"
                  confirm="Praxis reaktivieren? Die Zugänge, die mit der Praxis gesperrt wurden, funktionieren danach wieder."
                >
                  Praxis reaktivieren
                </PendingSubmitButton>
                <p className="mt-2 text-sm text-fg-primary">
                  Archiviert seit {formatDateTime(clinic.archivedAt)}.
                </p>
              </form>
            ) : (
              <form action={archiveClinicAction}>
                <input type="hidden" name="id" value={clinic.id} />
                <DangerSubmitButton
                  confirm="Praxis archivieren? Alle Zugänge werden gesperrt und angemeldete Personen sofort abgemeldet."
                  pendingLabel="Wird archiviert …"
                >
                  Praxis archivieren
                </DangerSubmitButton>
              </form>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>DSGVO</CardTitle>
          <CardDescription>
            Auskunftsanfragen und Löschungen. Jede Aktion wird im Audit-Log
            festgehalten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={`/admin/clinics/${clinic.id}/dsgvo`}
            className="text-sm text-accent hover:underline"
          >
            DSGVO-Werkzeuge öffnen →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
