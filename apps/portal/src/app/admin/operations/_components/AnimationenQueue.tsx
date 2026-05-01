import Link from "next/link";
import { Badge, Button, Input } from "@eins/ui";
import {
  ANIMATION_STATE_LABELS,
  type AnimationState,
} from "@/lib/constants";
import { formatRelative } from "@/lib/formatting";
import { updateAnimationStateAction } from "../../animations/actions";
import { QueueShell } from "./QueueShell";

interface AnimationRow {
  id: string;
  status: string;
  requestedAt: Date | null;
  requestNote: string | null;
  storageKeyCustomized: string | null;
  clinicId: string | null;
  clinicName: string | null;
  libraryTitle: string | null;
  libraryTreatment: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
}

export function AnimationenQueue({ rows }: { rows: AnimationRow[] }) {
  return (
    <QueueShell
      id="animationen"
      title="Animations-Wünsche"
      description={`Anfragen aus dem Animations-Katalog. Status-Wechsel auf „Bereit“ benachrichtigt automatisch.`}
      count={rows.length}
      tone="warn"
      emptyMessage="Keine offenen Animations-Anfragen."
    >
      <div className="space-y-4">
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-border bg-bg-primary/40 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{r.libraryTitle ?? "—"}</h3>
                <p className="text-xs text-fg-secondary">
                  <Link
                    href={`/admin/clinics/${r.clinicId}`}
                    className="hover:text-accent"
                  >
                    {r.clinicName}
                  </Link>{" "}
                  · {r.libraryTreatment ?? "ohne Kategorie"} · angefragt{" "}
                  {r.requestedAt ? formatRelative(r.requestedAt) : "—"} von{" "}
                  {r.requesterName ?? r.requesterEmail ?? "?"}
                </p>
              </div>
              <Badge
                tone={
                  r.status === "in_production"
                    ? "warn"
                    : r.status === "requested"
                      ? "neutral"
                      : "good"
                }
              >
                {ANIMATION_STATE_LABELS[r.status as AnimationState] ?? r.status}
              </Badge>
            </div>
            {r.requestNote && (
              <div className="mt-3 rounded-md border border-border bg-bg-secondary/40 p-3 text-sm">
                <div className="text-xs text-fg-secondary">Notiz der Klinik</div>
                <p className="mt-1 whitespace-pre-wrap">{r.requestNote}</p>
              </div>
            )}
            <form
              action={updateAnimationStateAction}
              className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]"
            >
              <input type="hidden" name="id" value={r.id} />
              <div>
                <label
                  htmlFor={`storage-${r.id}`}
                  className="text-xs text-fg-secondary"
                >
                  Speicher-Schlüssel der ausgelieferten Datei (optional)
                </label>
                <Input
                  id={`storage-${r.id}`}
                  name="storageKeyCustomized"
                  defaultValue={r.storageKeyCustomized ?? ""}
                  placeholder="clinics/<slug>/animations/<id>.mp4"
                  maxLength={1024}
                />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {r.status === "requested" && (
                  <Button
                    type="submit"
                    name="status"
                    value="in_production"
                    variant="outline"
                  >
                    In Produktion nehmen
                  </Button>
                )}
                <Button type="submit" name="status" value="ready">
                  Als ausgeliefert markieren
                </Button>
              </div>
            </form>
          </div>
        ))}
      </div>
    </QueueShell>
  );
}
