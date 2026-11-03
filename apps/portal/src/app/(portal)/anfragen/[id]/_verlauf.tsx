"use client";

import { useMemo } from "react";
import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarX,
  Clock,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@eins/ui";
import {
  ACTIVITY_KIND_LABELS,
  CALL_OUTCOME_LABELS,
  type ActivityKind,
  type CallOutcome,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import type { FollowupRow } from "@/server/queries/followups";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { TABLE_HEAD_BAND } from "../../dashboard/_components/dash-ui";
import { CenteredNote } from "../_components/CallQueue";
import { PlannedRow } from "./_followups";
import { VERLAUF_HEIGHT } from "./_lib/sizes";
import { isPendingId, useFollowups, usePending, type ActivityItem } from "./_pending";
import { statusChangeLine } from "./_status-change";

const ICON: Partial<Record<ActivityKind, LucideIcon>> = {
  call: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  note: NotebookPen,
  status_change: ArrowRightLeft,
};

type Entry = {
  id: string;
  at: Date;
  icon: LucideIcon;
  title: string;
  actor: string | null;
  body: string | null;
  saving: boolean;
};

function outcomeOf(meta: unknown): CallOutcome | null {
  const o = !!meta && typeof meta === "object" ? (meta as { outcome?: unknown }).outcome : null;
  return typeof o === "string" && o in CALL_OUTCOME_LABELS ? (o as CallOutcome) : null;
}

function fromActivity(a: ActivityItem): Entry {
  const kind = a.kind as ActivityKind;
  const outcome = kind === "call" ? outcomeOf(a.meta) : null;
  const title =
    kind === "status_change"
      ? (statusChangeLine(a.meta) ?? ACTIVITY_KIND_LABELS.status_change)
      : outcome
        ? `${ACTIVITY_KIND_LABELS.call}: ${CALL_OUTCOME_LABELS[outcome]}`
        : (ACTIVITY_KIND_LABELS[kind] ?? a.kind);
  return {
    id: a.id,
    at: a.createdAt,
    icon: ICON[kind] ?? Clock,
    title,
    actor: a.actorName ?? a.actorEmail,
    body: a.body,
    saving: isPendingId(a.id),
  };
}

/** A closed Wiedervorlage as an entry at the time it was closed (no activity row exists for it). */
function fromFollowup(f: FollowupRow): Entry {
  const done = f.status === "done";
  return {
    id: `followup-${f.id}`,
    at: f.completedAt ?? f.createdAt,
    icon: done ? CalendarCheck : CalendarX,
    title: done ? "Wiedervorlage erledigt" : "Wiedervorlage abgebrochen",
    actor: null,
    body: `Für ${formatDateTime(f.dueAt)}${f.note ? `: ${f.note}` : ""}`,
    saving: false,
  };
}

/**
 * The Verlauf (HubSpot's and Pipedrive's activity timeline): open
 * Wiedervorlagen on top under "Geplant", then everything that happened,
 * newest first. Each entry: what (a call with its result, a status move
 * from → to), when, who, and the text. What is still saving stands on top,
 * a little faded, until the server's list replaces it. One fixed height; the
 * list scrolls inside.
 */
export function Verlauf({
  requestId,
  name,
  activities,
  followups: fromServer,
  canWork,
}: {
  requestId: string;
  name: string;
  activities: ActivityItem[];
  followups: FollowupRow[];
  canWork: boolean;
}) {
  const { changes } = usePending();
  const followups = useFollowups(requestId, fromServer);
  const planned = followups.filter((f) => f.status === "pending");

  const entries = useMemo(() => {
    const saving = changes.flatMap((c) => c.activities ?? []);
    const list = [
      ...saving.map(fromActivity),
      ...activities.map(fromActivity),
      ...followups.filter((f) => f.status !== "pending").map(fromFollowup),
    ];
    return list.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [changes, activities, followups]);

  const empty = planned.length === 0 && entries.length === 0;

  return (
    <ScrollHint>
      <div
        role="region"
        aria-label="Verlauf"
        tabIndex={0}
        className={cn(
          "scroll-shadows -mx-2 overflow-y-auto px-2 [--scroll-bg:var(--surface-tile)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          VERLAUF_HEIGHT,
          empty && "flex"
        )}
      >
        {empty ? (
          <CenteredNote
            title="Noch kein Eintrag."
            text="Anrufe, Nachrichten, Notizen und Wiedervorlagen stehen hier."
          />
        ) : (
          <>
            {planned.length > 0 && (
              <>
                <p className={cn(TABLE_HEAD_BAND, "flex items-center px-3")}>Geplant</p>
                <ul className="divide-y divide-border">
                  {planned.map((f) => (
                    <PlannedRow key={f.id} requestId={requestId} name={name} followup={f} canWork={canWork} />
                  ))}
                </ul>
                {entries.length > 0 && <p className={cn(TABLE_HEAD_BAND, "flex items-center px-3")}>Bisher</p>}
              </>
            )}
            <ul className="divide-y divide-border">
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} />
              ))}
            </ul>
          </>
        )}
      </div>
    </ScrollHint>
  );
}

function EntryRow({ entry: e }: { entry: Entry }) {
  const Icon = e.icon;
  return (
    <li
      className={cn(
        "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 py-3 transition-opacity duration-300",
        e.saving && "opacity-60"
      )}
    >
      <span aria-hidden className="flex h-5 items-center text-fg-secondary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 break-words text-[15px] font-medium leading-5 text-fg-primary">{e.title}</p>
          <time className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary">{formatDateTime(e.at)}</time>
        </div>
        {e.actor && <p className="text-sm leading-5 text-fg-secondary">{e.actor}</p>}
        {e.body && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-fg-primary">{e.body}</p>
        )}
      </div>
    </li>
  );
}
