import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Textarea,
} from "@eins/ui";
import { PLAN_LABELS, PLAN_TIERS, type Plan } from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import type { schema } from "@/db/client";
import {
  archiveClinicAction,
  unarchiveClinicAction,
  overrideClinicPlanAction,
} from "../actions";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

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
          <CardTitle>Plan manuell ändern</CardTitle>
          <CardDescription>
            Notfall-Override unabhängig vom Upgrade-Anfrage-Workflow. Wird im
            Audit-Log als <code>plan_manual_override</code> erfasst.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={overrideClinicPlanAction}
            className="grid gap-4 md:grid-cols-2"
          >
            <input type="hidden" name="id" value={clinic.id} />
            <div>
              <Label htmlFor="plan-override">Neuer Plan</Label>
              <Select name="plan" defaultValue={clinic.plan} required>
                <SelectTrigger id="plan-override">
                  <SelectValue placeholder="Plan wählen" />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_TIERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLAN_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-fg-secondary">
                Aktueller Plan:{" "}
                <Badge tone="neutral">
                  {PLAN_LABELS[clinic.plan as Plan] ?? clinic.plan}
                </Badge>
              </p>
            </div>
            <div>
              <Label htmlFor="reason">Begründung (Pflicht)</Label>
              <Textarea
                id="reason"
                name="reason"
                rows={3}
                minLength={3}
                maxLength={500}
                placeholder="z.B. Pilot-Kondition für Q2, händisch nach Telefonat"
                required
              />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="outline">
                Plan überschreiben
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
