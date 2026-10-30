"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@eins/ui";
import { hiddenKeys, visibleCalls, type LogEntry, type VisibleCalls } from "../_lib/call-visible";

// Optimistic "Jetzt anrufen" (Karam, 2026-10-30): a tapped result moves the
// card to the next patient at once, the save runs in the background. The
// server renders the first few call cards and a row for every call it sent;
// this file only decides which of them are on screen.
//
// A tap hides its call in a `useOptimistic` layer that lives exactly as long
// as the save's transition: when the action returns, the revalidated page has
// landed in the same commit, so the layer drops away and the server's list is
// the truth again (a "Nicht erreicht" patient may be further back, that is
// right). A save that fails brings that patient back at once: onto the card
// when nobody is on it, otherwise to the first row of "Als Nächstes" (`behind`),
// so it never pulls the card away from the patient the user is working on.
// `behind` holds until the next server render. The layer itself only drops
// when every running save is done, React batches concurrent actions.

/**
 * Runs one save for the call on the card and hides that call while it runs.
 * Call it synchronously inside the `startTransition` that awaits it. A result
 * with `ok: false` and a throw both bring the patient back.
 */
export type TrackCall = <T extends { ok: boolean }>(save: () => Promise<T>) => Promise<T>;

interface QueueState {
  visible: VisibleCalls;
  trackerFor: (key: string) => TrackCall;
}

const QueueContext = createContext<QueueState | null>(null);
/** Set around the call card: the outcome buttons on it report here. Null elsewhere. */
const TrackContext = createContext<TrackCall | null>(null);

/** For the outcome buttons: null when they are not on a call card (today's behaviour). */
export function useTrackedCall(): TrackCall | null {
  return useContext(TrackContext);
}

function useQueueState(): QueueState {
  const state = useContext(QueueContext);
  if (!state) throw new Error("CallHeroSlot and CallQueueList belong inside CallQueueState");
  return state;
}

const NO_ENTRIES: readonly LogEntry[] = [];
const NO_KEYS: string[] = [];

export function CallQueueState({
  order,
  slots,
  loadedCap,
  cardKeys,
  pinnedKey = null,
  children,
}: {
  /** Keys of the calls the server sent, in call order. */
  order: string[];
  /** Rows "Als Nächstes" has room for. */
  slots: number;
  /** How many calls the server loads at most (hero plus slots). */
  loadedCap: number;
  /** Calls the server rendered a card for: only these can be on the card. */
  cardKeys: readonly string[];
  /** The Wiederbehandlung the server forced into the last visible place. */
  pinnedKey?: string | null;
  children: ReactNode;
}) {
  const [entries, addEntry] = useOptimistic<readonly LogEntry[], LogEntry>(NO_ENTRIES, (cur, entry) => [
    ...cur,
    entry,
  ]);
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  // Failed saves that go back behind the patient on the card; valid for the
  // order they were made in, a new server render drops them.
  const [behind, setBehind] = useState<{ order: string[]; keys: string[] }>({ order: [], keys: [] });
  const seq = useRef(0);
  const orderKeys = behind.order === order ? behind.keys : NO_KEYS;
  const visible = useMemo(
    () => visibleCalls(order, hiddenKeys(entries, failed), slots, loadedCap, { behind: orderKeys, pinned: pinnedKey }),
    [order, entries, failed, slots, loadedCap, orderKeys, pinnedKey]
  );
  // What is on screen now, for a save that fails later.
  const latest = useRef({ order, hero: visible.hero, cardKeys });
  latest.current = { order, hero: visible.hero, cardKeys };

  const trackerFor = useCallback(
    (key: string): TrackCall =>
      async (save) => {
        const id = ++seq.current;
        const fail = () => {
          setFailed((prev) => new Set(prev).add(id));
          // Another patient is on the card now: this one waits in the rows.
          const { order: at, hero, cardKeys: cards } = latest.current;
          const away = hero !== null && hero !== key && cards.includes(hero);
          setBehind((prev) => {
            const kept = (prev.order === at ? prev.keys : NO_KEYS).filter((k) => k !== key);
            return { order: at, keys: away ? [...kept, key] : kept };
          });
        };
        addEntry({ key, id });
        try {
          const res = await save();
          if (!res.ok) fail();
          return res;
        } catch (err) {
          fail();
          throw err;
        }
      },
    [addEntry]
  );

  const value = useMemo<QueueState>(() => ({ visible, trackerFor }), [visible, trackerFor]);

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export interface SlotNode {
  key: string;
  node: ReactNode;
}

/**
 * "Jetzt anrufen": the call card of the first call not logged yet. The next
 * patient's card arrives without the entrance rise (the card was there, only
 * its content changed); the first paint keeps it.
 */
export function CallHeroSlot({
  nodes,
  empty,
  loading,
}: {
  /** The call cards the server rendered, the first few calls. */
  nodes: SlotNode[];
  /** Same card as the server shows with nobody to call. */
  empty: ReactNode;
  /** A card of the same size: the calls rendered so far are all logged, the server's list is on its way. */
  loading: ReactNode;
}) {
  const { visible, trackerFor } = useQueueState();
  const { hero, moreMayExist } = visible;
  const node = hero ? nodes.find((n) => n.key === hero)?.node : undefined;
  const track = useMemo(() => (hero ? trackerFor(hero) : null), [hero, trackerFor]);

  let slotKey: string;
  let content: ReactNode;
  if (hero && node !== undefined && track) {
    slotKey = hero;
    content = <TrackContext.Provider value={track}>{node}</TrackContext.Provider>;
  } else if (hero || moreMayExist) {
    slotKey = "loading";
    content = loading;
  } else {
    slotKey = "empty";
    content = empty;
  }

  // Sticky: once the card has changed it stays without the rise, also when
  // the same patient comes back after a failed save.
  const [firstKey] = useState(slotKey);
  const [swapped, setSwapped] = useState(false);
  if (!swapped && slotKey !== firstKey) setSwapped(true);

  return (
    <div className={cn("contents", swapped && "[&>section]:[animation:none]")}>
      <Fragment key={slotKey}>{content}</Fragment>
    </div>
  );
}

/**
 * The rows of "Als Nächstes": the next calls after the one on the card,
 * `slots` of them. A row that leaves shifts the rest up.
 */
export function CallQueueList({
  nodes,
  className,
  empty,
}: {
  /** The rows the server rendered, one per call after the first. */
  nodes: SlotNode[];
  /** The list at its fixed height (the rows scroll inside it). */
  className: string;
  /** The one sentence for no more calls, in the list's space. */
  empty: ReactNode;
}) {
  const { visible } = useQueueState();
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n.node])), [nodes]);
  const rows = visible.rows.flatMap((key) =>
    byKey.has(key) ? [<Fragment key={key}>{byKey.get(key)}</Fragment>] : []
  );

  // With every row gone but more calls possibly waiting, no sentence: the
  // server's list is about to fill the space.
  if (rows.length === 0 && !visible.moreMayExist) return <>{empty}</>;
  return <ul className={className}>{rows}</ul>;
}
