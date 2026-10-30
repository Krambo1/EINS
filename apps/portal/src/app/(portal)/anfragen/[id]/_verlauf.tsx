"use client";

import { Avatar, cn } from "@eins/ui";
import { Clock, CheckCircle2, Mail, MessageSquare, Phone } from "lucide-react";
import { ACTIVITY_KIND_LABELS, type ActivityKind } from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import { formatDuration } from "./_duration";
import { isPendingId, usePending, type ActivityItem } from "./_pending";
import { statusChangeLine } from "./_status-change";

/**
 * The entries of the Verlauf, newest first. What is still saving (a call, a
 * note, a status change from the dialogs) stands on top as a real entry, a
 * little faded until the server confirms; the server's list then replaces it
 * without anything moving.
 */
export function VerlaufList({ activities }: { activities: ActivityItem[] }) {
  const { changes } = usePending();
  const saving = changes.flatMap((c) => c.activities ?? []).reverse();
  const items = saving.length > 0 ? [...saving, ...activities] : activities;

  if (items.length === 0) {
    return (
      <p className="text-sm text-fg-primary">
        Noch kein Verlauf. Protokollieren Sie den ersten Anruf oder hinterlassen Sie eine Notiz.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((a, idx) => {
        const prev = items[idx + 1];
        const gapMs = prev ? a.createdAt.getTime() - prev.createdAt.getTime() : null;
        const statusLine = a.kind === "status_change" ? statusChangeLine(a.meta) : null;
        return (
          <li
            key={a.id}
            className={cn("py-3 transition-opacity duration-300", isPendingId(a.id) && "opacity-60")}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-primary">
              <ActivityIcon kind={a.kind as ActivityKind} />
              <span className="font-medium">{ACTIVITY_KIND_LABELS[a.kind as ActivityKind] ?? a.kind}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{formatDateTime(a.createdAt)}</span>
              {(a.actorName || a.actorEmail) && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                    <Avatar name={a.actorName ?? a.actorEmail ?? "?"} size="xs" />
                    {a.actorName ?? a.actorEmail}
                  </span>
                </>
              )}
              {gapMs != null && gapMs > 0 && (
                <span className="text-fg-secondary md:ml-auto">+{formatDuration(gapMs)} nach vorigem Eintrag</span>
              )}
            </div>
            {statusLine && <p className="mt-1 text-base text-fg-primary">{statusLine}</p>}
            {a.body && <p className="mt-1 whitespace-pre-wrap text-base text-fg-primary">{a.body}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  switch (kind) {
    case "call":
      return <Phone className="h-3.5 w-3.5" />;
    case "email":
      return <Mail className="h-3.5 w-3.5" />;
    case "whatsapp":
    case "note":
      return <MessageSquare className="h-3.5 w-3.5" />;
    case "status_change":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    default:
      return <Clock className="h-3.5 w-3.5" />;
  }
}
