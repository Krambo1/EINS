import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
} from "@eins/ui";
import { formatDateTime } from "@/lib/formatting";
import type { schema } from "@/db/client";
import {
  archiveClinicAction,
  unarchiveClinicAction,
} from "../actions";

const GLOW_CARD = "!bg-bg-secondary/60";

export function VerwaltungTab({
  clinic,
}: {
  clinic: typeof schema.clinics.$inferSelect;
}) {
  const isArchived = clinic.archivedAt !== null;
  return (
    <div className="space-y-5">
      <Card className={GLOW_CARD}>
        <CardHeader>
          <CardTitle>Klinik-Status</CardTitle>
          <CardDescription>
            Archivierte Kliniken sind für Nutzer gesperrt, bleiben aber in der
            Datenbank. Der Vorgang ist umkehrbar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isArchived ? (
              <form action={unarchiveClinicAction}>
                <input type="hidden" name="id" value={clinic.id} />
                <Button type="submit" variant="outline">
                  Klinik reaktivieren
                </Button>
                <p className="mt-2 text-xs text-fg-secondary">
                  Archiviert seit {formatDateTime(clinic.archivedAt)}.
                </p>
              </form>
            ) : (
              <form action={archiveClinicAction}>
                <input type="hidden" name="id" value={clinic.id} />
                <Button type="submit" variant="outline">
                  Klinik archivieren
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
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
