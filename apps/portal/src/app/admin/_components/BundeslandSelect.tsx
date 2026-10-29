import { Label } from "@eins/ui";
import { BUNDESLAENDER, BUNDESLAND_LABELS } from "@/lib/bundesland";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Land of the Praxis (clinics.bundesland). Field name "bundesland"; the empty
 * option submits "" = not stored. Used by the clinic create and edit forms.
 */
export function BundeslandSelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <>
      <Label htmlFor="bundesland">Bundesland der Praxis</Label>
      <select id="bundesland" name="bundesland" defaultValue={defaultValue ?? ""} className={SELECT_CLASS}>
        <option value="">Nicht angegeben</option>
        {BUNDESLAENDER.map((code) => (
          <option key={code} value={code}>
            {BUNDESLAND_LABELS[code]}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-fg-secondary">
        Bestimmt die Feiertage der 48-Werkstunden-Frist. Ohne Angabe lässt das Portal jeden Feiertag
        aller Bundesländer aus.
      </p>
    </>
  );
}
