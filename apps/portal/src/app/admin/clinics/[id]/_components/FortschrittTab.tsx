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
import { formatDate } from "@/lib/formatting";
import {
  TIMELINE_STATUSES,
  TIMELINE_STATUS_LABELS,
  type TimelineStatus,
} from "@/lib/constants";
import type { TimelineEntry } from "@/server/queries/timeline";
import {
  createTimelineEntryAction,
  deleteTimelineEntryAction,
  updateTimelineEntryAction,
} from "../actions";

const GLOW_CARD = "!bg-bg-secondary/60";

function statusTone(
  status: TimelineStatus
): "neutral" | "accent" | "good" | "warn" | "bad" {
  if (status === "laeuft") return "accent";
  if (status === "abgeschlossen") return "good";
  return "neutral";
}

function toDateInputValue(d: Date): string {
  // yyyy-mm-dd in UTC — keeps display consistent regardless of admin's TZ.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIsoDate(): string {
  return toDateInputValue(new Date());
}

export function FortschrittTab({
  clinicId,
  entries,
}: {
  clinicId: string;
  entries: TimelineEntry[];
}) {
  return (
    <div className="space-y-5">
      <Card className={GLOW_CARD}>
        <CardHeader>
          <CardTitle>Neuer Eintrag</CardTitle>
          <CardDescription>
            Was passiert für diese Klinik? Sichtbar für alle Rollen im
            Kundenportal unter „Fortschritt“.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createTimelineEntryAction}
            className="grid gap-4 md:grid-cols-12"
          >
            <input type="hidden" name="clinicId" value={clinicId} />

            <div className="md:col-span-6">
              <Label htmlFor="ft-title">Titel</Label>
              <Input
                id="ft-title"
                name="title"
                required
                minLength={2}
                maxLength={200}
                placeholder="z. B. Meta-Kampagne Botox gestartet"
              />
            </div>

            <div className="md:col-span-3">
              <Label htmlFor="ft-eventDate">Datum</Label>
              <Input
                id="ft-eventDate"
                name="eventDate"
                type="date"
                defaultValue={todayIsoDate()}
                required
              />
            </div>

            <div className="md:col-span-3">
              <Label htmlFor="ft-status">Status</Label>
              <select
                id="ft-status"
                name="status"
                defaultValue="geplant"
                className="flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                required
              >
                {TIMELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TIMELINE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-12">
              <Label htmlFor="ft-description">Beschreibung (optional)</Label>
              <Textarea
                id="ft-description"
                name="description"
                rows={3}
                maxLength={5000}
                placeholder="Kurze Notiz für den Klinik-Inhaber."
              />
            </div>

            <div className="md:col-span-12 flex justify-end">
              <Button type="submit">Eintrag anlegen</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardHeader>
          <CardTitle>Einträge ({entries.length})</CardTitle>
          <CardDescription>
            Aufklappen, um zu bearbeiten. „Läuft“-Einträge erscheinen oben in der
            Klinik-Ansicht.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-fg-secondary">
              Noch keine Einträge.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((e) => {
                const status = e.status as TimelineStatus;
                return (
                  <li key={e.id} className="px-6 py-4">
                    <details className="group">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 list-none [&::-webkit-details-marker]:hidden">
                        <Badge tone={statusTone(status)}>
                          {TIMELINE_STATUS_LABELS[status] ?? status}
                        </Badge>
                        <span className="text-xs text-fg-secondary tabular-nums">
                          {formatDate(e.eventDate)}
                        </span>
                        <span className="font-medium text-fg-primary">
                          {e.title}
                        </span>
                        <span className="ml-auto text-xs text-fg-secondary group-open:hidden">
                          Bearbeiten ▾
                        </span>
                        <span className="ml-auto hidden text-xs text-fg-secondary group-open:inline">
                          Schließen ▴
                        </span>
                      </summary>

                      <div className="mt-4 grid gap-4 md:grid-cols-12">
                        <form
                          action={updateTimelineEntryAction}
                          className="md:col-span-12 grid gap-4 md:grid-cols-12"
                        >
                          <input type="hidden" name="id" value={e.id} />

                          <div className="md:col-span-6">
                            <Label htmlFor={`ft-title-${e.id}`}>Titel</Label>
                            <Input
                              id={`ft-title-${e.id}`}
                              name="title"
                              required
                              minLength={2}
                              maxLength={200}
                              defaultValue={e.title}
                            />
                          </div>

                          <div className="md:col-span-3">
                            <Label htmlFor={`ft-date-${e.id}`}>Datum</Label>
                            <Input
                              id={`ft-date-${e.id}`}
                              name="eventDate"
                              type="date"
                              required
                              defaultValue={toDateInputValue(e.eventDate)}
                            />
                          </div>

                          <div className="md:col-span-3">
                            <Label htmlFor={`ft-status-${e.id}`}>Status</Label>
                            <select
                              id={`ft-status-${e.id}`}
                              name="status"
                              defaultValue={status}
                              className="flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              required
                            >
                              {TIMELINE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {TIMELINE_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-12">
                            <Label htmlFor={`ft-desc-${e.id}`}>
                              Beschreibung
                            </Label>
                            <Textarea
                              id={`ft-desc-${e.id}`}
                              name="description"
                              rows={3}
                              maxLength={5000}
                              defaultValue={e.description ?? ""}
                            />
                          </div>

                          <div className="md:col-span-12 flex justify-end gap-2">
                            <Button type="submit">Speichern</Button>
                          </div>
                        </form>

                        <form
                          action={deleteTimelineEntryAction}
                          className="md:col-span-12 flex justify-end border-t border-border pt-3"
                        >
                          <input type="hidden" name="id" value={e.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Eintrag löschen
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
