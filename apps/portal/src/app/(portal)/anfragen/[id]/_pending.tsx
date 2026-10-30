"use client";

import { createContext, useContext, useMemo, useOptimistic, type ReactNode } from "react";
import type { FollowupStatus, RequestStatus } from "@/lib/constants";
import type { FollowupRow } from "@/server/queries/followups";

/**
 * What the Anfrage page shows while a save is still on its way (optimistic
 * UI). The dialogs, the Wiedervorlagen and the Wiederbehandlung toggle write a
 * change here inside their transition; the Verlauf, the status, the proof
 * numbers, the Wiedervorlagen and the Wiederbehandlung line read it and merge
 * it with what the server sent. The list is React's `useOptimistic` over an
 * empty base: when the action returns, the revalidated page arrives in the
 * same commit and every change drops away by itself, and a failed save leaves
 * nothing behind.
 */

/** One Verlauf entry, shaped like the server's row (serialisable). */
export type ActivityItem = {
  id: string;
  kind: string;
  actorName: string | null;
  actorEmail: string | null;
  body: string | null;
  meta: unknown;
  createdAt: Date;
};

export type PendingChange = {
  at: Date;
  /** New Verlauf entries, oldest first. */
  activities?: ActivityItem[];
  /** A Wiedervorlage that was just planned. */
  followup?: { id: string; dueAt: Date; note: string | null };
  /** The status the Anfrage has after this change. */
  status?: RequestStatus;
  /** Counts as the first contact (Reaktionszeit). */
  contact?: boolean;
  /** A Wiedervorlage that was just ticked off or cancelled. */
  resolve?: { followupId: string; to: Exclude<FollowupStatus, "pending"> };
  /** A Wiederbehandlung that was just taken off the calendar or put back. */
  retreatment?: { cycleId: string; dismissed: boolean };
};

type Actor = { name: string | null; email: string };

type PendingContext = {
  changes: PendingChange[];
  /** Call inside `startTransition`, before the first `await`. */
  add: (change: PendingChange) => void;
  actor: Actor;
};

const NONE: PendingChange[] = [];

const Ctx = createContext<PendingContext>({
  changes: NONE,
  add: () => {},
  actor: { name: null, email: "" },
});

export function PendingProvider({
  actorName,
  actorEmail,
  children,
}: {
  actorName: string | null;
  actorEmail: string;
  children: ReactNode;
}) {
  const [changes, add] = useOptimistic<PendingChange[], PendingChange>(NONE, (list, change) => [
    ...list,
    change,
  ]);
  const value = useMemo(
    () => ({ changes, add, actor: { name: actorName, email: actorEmail } }),
    [changes, add, actorName, actorEmail]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePending(): PendingContext {
  return useContext(Ctx);
}

let counter = 0;
const PENDING_PREFIX = "pending-";

/** Id of an entry that exists only in the browser so far. */
export function pendingId(): string {
  counter += 1;
  return `${PENDING_PREFIX}${Date.now()}-${counter}`;
}

export function isPendingId(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/** A Verlauf entry for the signed-in person, as the server will write it. */
export function newActivity(
  actor: Actor,
  at: Date,
  kind: string,
  body: string | null,
  meta: unknown = null
): ActivityItem {
  return { id: pendingId(), kind, actorName: actor.name, actorEmail: actor.email, body, meta, createdAt: at };
}

/** The status the Anfrage is about to have, or null when nothing changes it. */
export function usePendingStatus(): RequestStatus | null {
  const { changes } = usePending();
  for (let i = changes.length - 1; i >= 0; i--) {
    const s = changes[i].status;
    if (s) return s;
  }
  return null;
}

/** Wiederbehandlung state: the pending tap wins over what the server sent. */
export function usePendingDismissed(cycleId: string, server: boolean): boolean {
  const { changes } = usePending();
  for (let i = changes.length - 1; i >= 0; i--) {
    const r = changes[i].retreatment;
    if (r && r.cycleId === cycleId) return r.dismissed;
  }
  return server;
}

/**
 * The Wiedervorlagen with the pending changes applied, in the server's order:
 * open ones soonest due first, finished ones newest first.
 */
export function mergeFollowups(
  requestId: string,
  server: FollowupRow[],
  changes: PendingChange[],
  actorName: string | null
): FollowupRow[] {
  if (changes.every((c) => !c.followup && !c.resolve)) return server;
  let list = server;
  for (const c of changes) {
    if (c.followup) {
      list = [
        ...list,
        {
          id: c.followup.id,
          requestId,
          dueAt: c.followup.dueAt,
          note: c.followup.note,
          status: "pending",
          createdByName: actorName,
          completedAt: null,
          createdAt: c.at,
        },
      ];
    }
    if (c.resolve) {
      const { followupId, to } = c.resolve;
      list = list.map((f) =>
        f.id === followupId && f.status === "pending" ? { ...f, status: to, completedAt: c.at } : f
      );
    }
  }
  const open = list.filter((f) => f.status === "pending").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const done = list.filter((f) => f.status !== "pending").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return [...open, ...done];
}

/** The Wiedervorlagen of this page with whatever is still saving. */
export function useFollowups(requestId: string, server: FollowupRow[]): FollowupRow[] {
  const { changes, actor } = usePending();
  return useMemo(
    () => mergeFollowups(requestId, server, changes, actor.name),
    [requestId, server, changes, actor.name]
  );
}
