import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@eins/ui";
import {
  TIMELINE_STATUSES,
  TIMELINE_STATUS_LABELS,
  type TimelineStatus,
} from "@/lib/constants";
import type { DefaultJourneyStep } from "@/server/timeline-journey";
import {
  createDefaultStepAction,
  deleteDefaultStepAction,
  updateDefaultStepAction,
} from "../actions";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function statusTone(
  status: TimelineStatus
): "neutral" | "accent" | "good" | "warn" | "bad" {
  if (status === "laeuft") return "accent";
  if (status === "abgeschlossen") return "good";
  return "neutral";
}

export function JourneyTemplateEditor({
  steps,
}: {
  steps: DefaultJourneyStep[];
}) {
  // 10er-Schritte lassen Platz zum Einschieben (15 sortiert zwischen 10 und 20).
  const nextSort = steps.length
    ? Math.max(...steps.map((s) => s.sortOrder)) + 10
    : 10;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Neuer Schritt</CardTitle>
          <CardDescription>
            Wird in die Vorlage aufgenommen. Die Reihenfolge bestimmt die Zahl
            „Sortierung“ (kleiner = weiter oben). Neue Schritte landen erst beim
            nächsten Einsetzen in einer Praxis, bestehende Praxen bleiben
            unberührt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createDefaultStepAction}
            className="grid gap-4 md:grid-cols-12"
          >
            <div className="md:col-span-6">
              <Label htmlFor="js-title">Titel</Label>
              <Input
                id="js-title"
                name="title"
                required
                minLength={2}
                maxLength={200}
                placeholder="z. B. Produktionstag in Ihrer Praxis"
              />
            </div>

            <div className="md:col-span-3">
              <Label htmlFor="js-phase">Phase (Label)</Label>
              <Input
                id="js-phase"
                name="phaseLabel"
                maxLength={80}
                placeholder="z. B. Woche 1 bis 2"
              />
            </div>

            <div className="md:col-span-3">
              <Label htmlFor="js-sort">Sortierung</Label>
              <Input
                id="js-sort"
                name="sortOrder"
                type="number"
                min={0}
                max={100000}
                step={10}
                defaultValue={nextSort}
                required
              />
            </div>

            <div className="md:col-span-3">
              <Label htmlFor="js-status">Start-Status</Label>
              <select
                id="js-status"
                name="defaultStatus"
                defaultValue="geplant"
                className={SELECT_CLASS}
                required
              >
                {TIMELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TIMELINE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <Label htmlFor="js-active">Sichtbar</Label>
              <select
                id="js-active"
                name="isActive"
                defaultValue="1"
                className={SELECT_CLASS}
                required
              >
                <option value="1">Aktiv</option>
                <option value="0">Inaktiv</option>
              </select>
            </div>

            <div className="md:col-span-12">
              <Label htmlFor="js-desc">Beschreibung (optional)</Label>
              <Textarea
                id="js-desc"
                name="description"
                rows={3}
                maxLength={5000}
                placeholder="Was passiert in diesem Schritt? Inhaber-Sicht, formelles Sie."
              />
            </div>

            <div className="md:col-span-12 flex justify-end">
              <Button type="submit">Schritt anlegen</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schritte ({steps.length})</CardTitle>
          <CardDescription>
            Aufklappen, um zu bearbeiten. Inaktive Schritte werden nicht in neue
            Praxen eingesetzt.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {steps.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-fg-secondary">
              Noch keine Schritte in der Vorlage.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {steps.map((s) => {
                const status = s.defaultStatus;
                return (
                  <li key={s.id} className="px-6 py-4">
                    <details className="group">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 list-none [&::-webkit-details-marker]:hidden">
                        <span className="w-10 shrink-0 text-xs text-fg-secondary tabular-nums">
                          {s.sortOrder}
                        </span>
                        <Badge tone={statusTone(status)}>
                          {TIMELINE_STATUS_LABELS[status] ?? status}
                        </Badge>
                        {s.phaseLabel && (
                          <span className="text-xs text-fg-secondary">
                            {s.phaseLabel}
                          </span>
                        )}
                        <span className="font-medium text-fg-primary">
                          {s.title}
                        </span>
                        {!s.isActive && <Badge tone="warn">Inaktiv</Badge>}
                        <span className="ml-auto text-xs text-fg-secondary group-open:hidden">
                          Bearbeiten ▾
                        </span>
                        <span className="ml-auto hidden text-xs text-fg-secondary group-open:inline">
                          Schließen ▴
                        </span>
                      </summary>

                      <div className="mt-4 grid gap-4 md:grid-cols-12">
                        <form
                          action={updateDefaultStepAction}
                          className="md:col-span-12 grid gap-4 md:grid-cols-12"
                        >
                          <input type="hidden" name="id" value={s.id} />

                          <div className="md:col-span-6">
                            <Label htmlFor={`js-title-${s.id}`}>Titel</Label>
                            <Input
                              id={`js-title-${s.id}`}
                              name="title"
                              required
                              minLength={2}
                              maxLength={200}
                              defaultValue={s.title}
                            />
                          </div>

                          <div className="md:col-span-3">
                            <Label htmlFor={`js-phase-${s.id}`}>
                              Phase (Label)
                            </Label>
                            <Input
                              id={`js-phase-${s.id}`}
                              name="phaseLabel"
                              maxLength={80}
                              defaultValue={s.phaseLabel ?? ""}
                            />
                          </div>

                          <div className="md:col-span-3">
                            <Label htmlFor={`js-sort-${s.id}`}>Sortierung</Label>
                            <Input
                              id={`js-sort-${s.id}`}
                              name="sortOrder"
                              type="number"
                              min={0}
                              max={100000}
                              step={10}
                              defaultValue={s.sortOrder}
                              required
                            />
                          </div>

                          <div className="md:col-span-3">
                            <Label htmlFor={`js-status-${s.id}`}>
                              Start-Status
                            </Label>
                            <select
                              id={`js-status-${s.id}`}
                              name="defaultStatus"
                              defaultValue={status}
                              className={SELECT_CLASS}
                              required
                            >
                              {TIMELINE_STATUSES.map((opt) => (
                                <option key={opt} value={opt}>
                                  {TIMELINE_STATUS_LABELS[opt]}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-3">
                            <Label htmlFor={`js-active-${s.id}`}>Sichtbar</Label>
                            <select
                              id={`js-active-${s.id}`}
                              name="isActive"
                              defaultValue={s.isActive ? "1" : "0"}
                              className={SELECT_CLASS}
                              required
                            >
                              <option value="1">Aktiv</option>
                              <option value="0">Inaktiv</option>
                            </select>
                          </div>

                          <div className="md:col-span-12">
                            <Label htmlFor={`js-desc-${s.id}`}>
                              Beschreibung
                            </Label>
                            <Textarea
                              id={`js-desc-${s.id}`}
                              name="description"
                              rows={3}
                              maxLength={5000}
                              defaultValue={s.description ?? ""}
                            />
                          </div>

                          <div className="md:col-span-12 flex justify-end">
                            <Button type="submit">Speichern</Button>
                          </div>
                        </form>

                        <form
                          action={deleteDefaultStepAction}
                          className="md:col-span-12 flex justify-end border-t border-border pt-3"
                        >
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Schritt löschen
                          </Button>
                        </form>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
