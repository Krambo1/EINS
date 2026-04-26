import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Button,
  Separator,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@eins/ui";
import { PLAN_TIERS, PLAN_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import type { schema } from "@/db/client";
import { updateClinicAction } from "../actions";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

export function StammdatenTab({
  clinic,
}: {
  clinic: typeof schema.clinics.$inferSelect;
}) {
  return (
    <Card className={GLOW_CARD}>
      <CardHeader>
        <CardTitle>Stammdaten</CardTitle>
        <CardDescription>
          Anzeigename, Rechtsname, Plan und HWG-Kontakt. Änderung des Plans setzt
          den Start des Abo-Zyklus zurück.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateClinicAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={clinic.id} />

          <div className="md:col-span-1">
            <Label htmlFor="displayName">Anzeigename</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={clinic.displayName}
              required
              maxLength={200}
            />
          </div>

          <div className="md:col-span-1">
            <Label htmlFor="legalName">Rechtsname</Label>
            <Input
              id="legalName"
              name="legalName"
              defaultValue={clinic.legalName}
              required
              maxLength={200}
            />
          </div>

          <div className="md:col-span-1">
            <Label htmlFor="plan">Plan</Label>
            <Select name="plan" defaultValue={clinic.plan} required>
              <SelectTrigger id="plan">
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
              Aktueller Zyklus seit {formatDateTime(clinic.planStartedAt)}.
            </p>
          </div>

          <div className="md:col-span-1">
            <Label htmlFor="defaultDoctorEmail">
              Standard-Behandler (E-Mail)
            </Label>
            <Input
              id="defaultDoctorEmail"
              name="defaultDoctorEmail"
              type="email"
              defaultValue={clinic.defaultDoctorEmail ?? ""}
              maxLength={200}
            />
          </div>

          <Separator className="md:col-span-2" />

          <div className="md:col-span-1">
            <Label htmlFor="hwgContactName">HWG-Kontakt (Name)</Label>
            <Input
              id="hwgContactName"
              name="hwgContactName"
              defaultValue={clinic.hwgContactName ?? ""}
              maxLength={200}
            />
          </div>

          <div className="md:col-span-1">
            <Label htmlFor="hwgContactEmail">HWG-Kontakt (E-Mail)</Label>
            <Input
              id="hwgContactEmail"
              name="hwgContactEmail"
              type="email"
              defaultValue={clinic.hwgContactEmail ?? ""}
              maxLength={200}
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <Button type="submit">Änderungen speichern</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
