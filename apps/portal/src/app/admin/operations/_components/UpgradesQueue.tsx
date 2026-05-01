import Link from "next/link";
import {
  Badge,
  Button,
  Textarea,
} from "@eins/ui";
import { formatRelative } from "@/lib/formatting";
import { resolveUpgradeRequestAction } from "../../upgrade-requests/actions";
import { QueueShell } from "./QueueShell";

interface UpgradeRow {
  id: string;
  status: string;
  requestedAt: Date;
  userNote: string | null;
  clinicId: string | null;
  clinicName: string | null;
  clinicPlan: string | null;
  requesterEmail: string | null;
  requesterName: string | null;
}

export function UpgradesQueue({ rows }: { rows: UpgradeRow[] }) {
  return (
    <QueueShell
      id="upgrades"
      title="Upgrade-Anfragen"
      description={`Klinik-Inhaber wünschen Wechsel auf Plan „Erweitert“. Freigabe stellt sofort um.`}
      count={rows.length}
      tone="warn"
      emptyMessage="Keine offenen Upgrade-Anfragen."
    >
      <div className="space-y-4">
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-border bg-bg-primary/40 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link
                  href={`/admin/clinics/${r.clinicId}`}
                  className="font-medium text-fg-primary hover:text-accent"
                >
                  {r.clinicName ?? "—"}
                </Link>
                <p className="text-xs text-fg-secondary">
                  Eingereicht {formatRelative(r.requestedAt)} von{" "}
                  {r.requesterName ?? r.requesterEmail ?? "?"} · aktueller Plan:{" "}
                  {r.clinicPlan}
                </p>
              </div>
              <Badge tone="warn">Offen</Badge>
            </div>
            {r.userNote && (
              <div className="mt-3 rounded-md border border-border bg-bg-secondary/40 p-3 text-sm">
                <div className="text-xs text-fg-secondary">
                  Nachricht des Inhabers
                </div>
                <p className="mt-1 whitespace-pre-wrap">{r.userNote}</p>
              </div>
            )}
            <form
              action={resolveUpgradeRequestAction}
              className="mt-3 space-y-3"
            >
              <input type="hidden" name="id" value={r.id} />
              <div>
                <label
                  htmlFor={`note-${r.id}`}
                  className="text-xs text-fg-secondary"
                >
                  Interne Notiz (geht in die E-Mail an die Klinik)
                </label>
                <Textarea
                  id={`note-${r.id}`}
                  name="karamNote"
                  rows={2}
                  maxLength={2000}
                  placeholder="Optional."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="decision" value="bearbeitet">
                  Freigeben &amp; Plan umstellen
                </Button>
                <Button
                  type="submit"
                  name="decision"
                  value="abgelehnt"
                  variant="outline"
                >
                  Ablehnen
                </Button>
              </div>
            </form>
          </div>
        ))}
      </div>
    </QueueShell>
  );
}
