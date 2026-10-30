"use client";

import { startTransition } from "react";
import { Card, CardHeader, CardTitle, CardContent, Button, cn } from "@eins/ui";
import { Check, X, AlarmClock } from "lucide-react";
import { formatDateTime } from "@/lib/formatting";
import type { FollowupStatus } from "@/lib/constants";
import type { FollowupRow } from "@/server/queries/followups";
import { showActionFlash } from "../../_components/flash-event";
import { completeFollowup, cancelFollowup, type ActionResult } from "./actions";
import { isPendingId, useFollowups, usePending } from "./_pending";

const RESOLVED_LABEL: Record<Exclude<FollowupStatus, "pending">, string> = {
  done: "Erledigt",
  cancelled: "Abgebrochen",
};

const OFFLINE = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";

/**
 * Wiedervorlagen-Liste auf der Anfrage-Detailseite. Offene Rückrufe oben mit
 * Erledigt/Abbrechen-Aktionen, darunter die abgeschlossene Historie als
 * read-only. Für alle Praxis-Rollen sichtbar (reuse `requests.update`).
 * Optimistisch: eine neu geplante Wiedervorlage steht sofort da, ein Tipp auf
 * Erledigt/Abbrechen schiebt die Zeile sofort in die Historie (_pending.tsx).
 */
export function Followups({
  requestId,
  followups: fromServer,
}: {
  requestId: string;
  followups: FollowupRow[];
}) {
  const followups = useFollowups(requestId, fromServer);

  // Always shown (DS3): before the first Wiedervorlage the card explains
  // how to set one, otherwise nobody knows the feature exists.
  if (followups.length === 0) {
    return (
      <Card className="p-5 md:p-6">
        <CardHeader className="mb-3">
          <CardTitle>Wiedervorlagen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-primary">
            Noch keine Wiedervorlage. Über „Wiedervorlage“ oben legen Sie fest,
            wann die Anfrage wieder oben in der Anrufliste steht.
          </p>
        </CardContent>
      </Card>
    );
  }

  const pending = followups.filter((f) => f.status === "pending");
  const resolved = followups.filter((f) => f.status !== "pending");

  return (
    <Card className="p-5 md:p-6">
      <CardHeader className="mb-3">
        <CardTitle>Wiedervorlagen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending.length > 0 ? (
          <ul className="space-y-2">
            {pending.map((f) => (
              <PendingRow key={f.id} requestId={requestId} followup={f} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-primary">
            Keine offene Wiedervorlage. Eine neue legen Sie oben mit
            „Wiedervorlage“ an.
          </p>
        )}

        {resolved.length > 0 && (
          <div className="border-t border-border pt-3">
            <ul className="divide-y divide-border">
              {resolved.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between py-2 text-sm text-fg-secondary"
                >
                  <span className="tabular-nums line-through decoration-fg-tertiary">
                    {formatDateTime(f.dueAt)}
                    {f.note ? ` · ${f.note}` : ""}
                  </span>
                  <span className="shrink-0 text-sm text-fg-secondary">
                    {RESOLVED_LABEL[f.status as Exclude<FollowupStatus, "pending">]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingRow({
  requestId,
  followup,
}: {
  requestId: string;
  followup: FollowupRow;
}) {
  const { add } = usePending();
  const overdue = followup.dueAt.getTime() <= Date.now();
  // Planned a moment ago and not confirmed yet: no id to resolve on the server.
  const saving = isPendingId(followup.id);

  // The row moves to the finished ones at once. If the server says no, the
  // change drops away (the row comes back) and a toast says why. The row is
  // gone while this runs, so the transition is not tied to this component.
  const resolve = (
    action: (fd: FormData) => Promise<ActionResult>,
    to: "done" | "cancelled",
    savedTitle: string
  ) => {
    const fd = new FormData();
    fd.set("followupId", followup.id);
    fd.set("requestId", requestId);
    startTransition(async () => {
      add({ at: new Date(), resolve: { followupId: followup.id, to } });
      try {
        const res = await action(fd);
        showActionFlash(
          res.ok
            ? { tone: "good", title: savedTitle }
            : { tone: "bad", title: "Nicht gespeichert", description: res.message }
        );
      } catch {
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: OFFLINE });
      }
    });
  };

  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-opacity duration-300",
        overdue
          ? "border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)]"
          : "border-border bg-bg-secondary",
        saving && "opacity-60"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium text-fg-primary tabular-nums">
          {overdue && <AlarmClock className="h-4 w-4 text-tone-warn" aria-hidden />}
          {formatDateTime(followup.dueAt)}
          {overdue && (
            <span className="text-sm font-semibold text-fg-primary">fällig</span>
          )}
        </div>
        {followup.note && (
          <p className="mt-0.5 truncate text-sm text-fg-secondary">
            {followup.note}
          </p>
        )}
        {followup.createdByName && (
          <p className="mt-0.5 text-sm text-fg-secondary">
            gesetzt von {followup.createdByName}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => resolve(completeFollowup, "done", "Wiedervorlage erledigt")}
        >
          <Check className="h-4 w-4" />
          Erledigt
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={() => resolve(cancelFollowup, "cancelled", "Wiedervorlage abgebrochen")}
          className="text-fg-secondary"
        >
          <X className="h-4 w-4" />
          Abbrechen
        </Button>
      </div>
    </li>
  );
}
