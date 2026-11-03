"use client";

import { startTransition, useCallback, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronDown, Lock } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  StatusPill,
  cn,
} from "@eins/ui";
import { REQUEST_STATUS_LABELS, STATUS_TRANSITIONS, type RequestStatus } from "@/lib/constants";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { CallOutcomeActions, OUTCOMES } from "../_components/CallOutcomeActions";
import { TrackCallProvider } from "../_components/CallQueueState";
import { parseBerlinLocalInput } from "../_lib/berlin-input";
import { formatDeadlineShort } from "../_lib/deadline";
import { formatDateTime } from "@/lib/formatting";
import { addNote, changeStatus, logMessage, scheduleFollowup, type ActionResult } from "./actions";
import { followupInputError } from "./_followup-date";
import { COMPOSER_HEIGHT } from "./_lib/sizes";
import { newActivity, pendingId, usePending, usePendingStatus, type PendingChange } from "./_pending";

const OFFLINE = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";

const MENU =
  "max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[13rem] overflow-auto rounded-[var(--r-panel)] border border-border elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]";

/**
 * The status in the record, changed where it is read (Linear's and Attio's
 * properties): a tap opens the moves this status allows, one tap saves. The
 * new status shows at once and the save runs in the background; a failure
 * puts the old one back and the toast names the patient. With a PVS
 * appointment the PVS owns the status (PVS wins): it shows with a lock.
 */
export function StatusMenu({
  requestId,
  name,
  status: fromServer,
  pvsControlled,
  canWork,
}: {
  requestId: string;
  name: string;
  status: string;
  pvsControlled: boolean;
  canWork: boolean;
}) {
  const pendingStatus = usePendingStatus();
  const status = (pendingStatus ?? fromServer) as RequestStatus;
  const { add, actor } = usePending();
  const transitions = STATUS_TRANSITIONS[status] ?? [];

  if (pvsControlled) {
    return (
      <span className="flex h-5 items-center gap-2">
        <StatusPill status={status} className="text-[15px]" />
        <span className="flex items-center gap-1 text-sm text-fg-secondary" title="Die PVS steuert den Status.">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          PVS
          <span className="sr-only">: Die PVS steuert den Status.</span>
        </span>
      </span>
    );
  }
  if (!canWork || transitions.length === 0) {
    return <StatusPill status={status} className="flex h-5 text-[15px]" />;
  }

  const save = (to: RequestStatus) => {
    const from = status;
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("status", to);
    fd.set("expectedStatus", from);
    startTransition(async () => {
      const at = new Date();
      add({
        at,
        activities: [newActivity(actor, at, "status_change", null, { from, to })],
        status: to,
        contact: from === "neu",
      });
      try {
        const res = await changeStatus(fd);
        showActionFlash(
          res.ok
            ? { tone: "good", title: "Status geändert", description: `${name}: ${REQUEST_STATUS_LABELS[to]}` }
            : { tone: "bad", title: "Nicht gespeichert", description: `${name}: ${res.message}` }
        );
      } catch {
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: `${name}: ${OFFLINE}` });
      }
    });
  };

  return (
    <DropdownMenu>
      {/* As tall as the row (44 px), so it is easy to hit on the phone. */}
      <DropdownMenuTrigger
        aria-label={`Status: ${REQUEST_STATUS_LABELS[status] ?? status}. Ändern`}
        className="-mx-2 -my-3 flex h-11 items-center gap-1.5 rounded-[var(--r-control)] px-2 transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <StatusPill status={status} className="text-[15px]" />
        <ChevronDown className="h-4 w-4 shrink-0 text-fg-secondary" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={MENU}>
        {transitions.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => save(s)}>
            <StatusPill status={s} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Ergebnis des Anrufs", the call card's switch as it is (one tap saves, no
 * question, the toast says what was saved). Here the tap also shows at once:
 * the switch reports through the call card's tracker, and this tracker puts
 * the call (and the status it sets) into the Verlauf and the record while it
 * saves. A failure drops it again; the switch's toast names the patient.
 */
export function CallResult({
  requestId,
  name,
  status: fromServer,
  pvsControlled,
}: {
  requestId: string;
  name: string;
  status: string;
  pvsControlled: boolean;
}) {
  const { add, actor } = usePending();
  const pendingStatus = usePendingStatus();
  const current = (pendingStatus ?? fromServer) as RequestStatus;
  const tapped = useRef<(typeof OUTCOMES)[number] | null>(null);

  // Runs inside the switch's transition, before its first await.
  const track = useCallback(
    <T extends { ok: boolean }>(save: () => Promise<T>): Promise<T> => {
      const o = tapped.current;
      tapped.current = null;
      if (o) {
        const at = new Date();
        const activities = [newActivity(actor, at, "call", null, { outcome: o.outcome })];
        const change: PendingChange = { at, activities, contact: true };
        const allowed = STATUS_TRANSITIONS[current] ?? [];
        // Same rule as the switch: only a legal move, never against the PVS.
        if (!pvsControlled && o.status !== current && allowed.includes(o.status)) {
          activities.push(newActivity(actor, at, "status_change", null, { from: current, to: o.status }));
          change.status = o.status;
        }
        add(change);
      }
      return save();
    },
    [actor, add, current, pvsControlled]
  );

  return (
    <div
      onClickCapture={(e) => {
        const label = (e.target as HTMLElement).closest("button")?.textContent?.trim();
        tapped.current = OUTCOMES.find((o) => o.label === label) ?? null;
      }}
    >
      <TrackCallProvider value={track}>
        <CallOutcomeActions
          requestId={requestId}
          name={name}
          currentStatus={current}
          pvsControlled={pvsControlled}
        />
      </TrackCallProvider>
    </div>
  );
}

type Tab = "note" | "message" | "followup";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "note", label: "Notiz" },
  { key: "message", label: "Nachricht" },
  { key: "followup", label: "Wiedervorlage" },
];
const PLACEHOLDER: Record<Tab, string> = {
  note: "Interne Notiz, zum Beispiel: Möchte erst nach dem Urlaub einen Termin.",
  message: "Was Sie geschrieben haben (freiwillig), zum Beispiel: Terminvorschläge geschickt.",
  followup: "Worum geht es beim Rückruf? (freiwillig)",
};
const SUBMIT: Record<Tab, string> = { note: "Speichern", message: "Vermerken", followup: "Planen" };
const CHANNELS = [
  { key: "email", label: "E-Mail" },
  { key: "whatsapp", label: "WhatsApp" },
] as const;
type Channel = (typeof CHANNELS)[number]["key"];

const EMPTY: Record<Tab, string> = { note: "", message: "", followup: "" };

/** A segment of a track on the well (the Rückmeldung's status switch). */
function segment(on: boolean): string {
  return cn(
    "flex h-full items-center justify-center rounded-[var(--r-control)] px-3 text-sm font-medium transition-[background-color,box-shadow,color] duration-300",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    on ? "elev-raised bg-[var(--surface-raised)] text-fg-primary" : "text-fg-secondary hover:text-fg-primary"
  );
}

/**
 * Note, sent message and Wiedervorlage in one place under the call result
 * (Pipedrive's and Close's composer above the history): three tabs of one
 * shape, a text field and a footer row, so switching never moves anything.
 * Saving is optimistic like everywhere on the page: the entry stands in the
 * Verlauf at once and the field empties; a failure takes the entry away, puts
 * the text back (unless something new was typed meanwhile) and the toast
 * names the patient. Strg+Enter saves.
 */
export function Composer({ requestId, name }: { requestId: string; name: string }) {
  const [tab, setTab] = useState<Tab>("note");
  const [texts, setTexts] = useState(EMPTY);
  const [channel, setChannel] = useState<Channel>("email");
  const [dueAt, setDueAt] = useState("");
  const [isPending, startSave] = useTransition();
  const { add, actor } = usePending();

  const text = texts[tab];
  const setText = (t: Tab, value: string) => setTexts((cur) => ({ ...cur, [t]: value }));
  const canSubmit = tab === "note" ? !!text.trim() : tab === "followup" ? !!dueAt : true;

  const run = (
    action: (fd: FormData) => Promise<ActionResult>,
    fd: FormData,
    change: PendingChange,
    saved: { title: string; description: string },
    restore: () => void
  ) => {
    startSave(async () => {
      add(change);
      const failed = (message: string) => {
        restore();
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: `${name}: ${message}` });
      };
      try {
        const res = await action(fd);
        if (res.ok) showActionFlash({ tone: "good", ...saved });
        else failed(res.message);
      } catch {
        failed(OFFLINE);
      }
    });
  };

  const submit = () => {
    if (!canSubmit) return;
    const t = tab;
    const body = texts[t].trim();
    const at = new Date();
    const fd = new FormData();
    fd.set("id", requestId);
    // Empty at once; back on failure, unless the field holds something new.
    const putBack = () => setTexts((cur) => (cur[t] ? cur : { ...cur, [t]: texts[t] }));
    setText(t, "");

    if (t === "note") {
      fd.set("note", body);
      run(
        addNote,
        fd,
        { at, activities: [newActivity(actor, at, "note", body)] },
        { title: "Notiz gespeichert", description: name },
        putBack
      );
      return;
    }
    if (t === "message") {
      const via = channel;
      fd.set("channel", via);
      if (body) fd.set("note", body);
      run(
        logMessage,
        fd,
        { at, activities: [newActivity(actor, at, via, body || null)], contact: true },
        { title: "Nachricht vermerkt", description: `${name}: ${via === "email" ? "E-Mail" : "WhatsApp"}` },
        putBack
      );
      return;
    }
    const value = dueAt;
    const dateError = followupInputError(value);
    const due = parseBerlinLocalInput(value);
    if (dateError || !due) {
      setText(t, texts[t]);
      showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: `${name}: ${dateError ?? "Bitte prüfen Sie das Datum."}` });
      return;
    }
    fd.set("dueAt", value);
    if (body) fd.set("note", body);
    setDueAt("");
    run(
      scheduleFollowup,
      fd,
      {
        at,
        followup: { id: pendingId(), dueAt: due, note: body || null },
        activities: [newActivity(actor, at, "note", `Wiedervorlage für ${formatDateTime(due)}${body ? `: ${body}` : ""}`)],
      },
      { title: "Wiedervorlage geplant", description: `${name}: ${formatDeadlineShort(due)}` },
      () => {
        putBack();
        setDueAt((cur) => cur || value);
      }
    );
  };

  let footer: ReactNode = <span />;
  if (tab === "message") {
    footer = (
      <div
        role="radiogroup"
        aria-label="Gesendet per"
        className="elev-inset grid h-[var(--control-h)] min-w-0 grid-cols-2 gap-1 rounded-[var(--r-panel)] bg-[var(--well)] p-1"
      >
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={channel === c.key}
            onClick={() => setChannel(c.key)}
            className={segment(channel === c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
    );
  } else if (tab === "followup") {
    footer = (
      <input
        type="datetime-local"
        aria-label="Fällig am"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className={cn(
          CONTROL,
          "elev-inset min-w-0 flex-1 border-0 bg-[var(--well)] px-3 text-[15px] tabular-nums text-fg-primary sm:max-w-[15rem]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        )}
      />
    );
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Festhalten"
        className="elev-inset grid h-[calc(var(--control-h)+0.5rem)] grid-cols-3 gap-1 rounded-[var(--r-panel)] bg-[var(--well)] p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`composer-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="composer-panel"
            onClick={() => setTab(t.key)}
            className={segment(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="composer-panel" role="tabpanel" aria-labelledby={`composer-tab-${tab}`}>
        <ScrollHint className="mt-3" watch={text}>
          <textarea
            aria-label={TABS.find((t) => t.key === tab)?.label}
            value={text}
            onChange={(e) => setText(tab, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={tab === "followup" ? 2000 : 5000}
            placeholder={PLACEHOLDER[tab]}
            className={cn(
              "scroll-shadows elev-inset block w-full resize-none rounded-[var(--r-panel)] border-0 px-4 py-3 text-[15px] leading-6 text-fg-primary placeholder:text-fg-tertiary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              COMPOSER_HEIGHT
            )}
          />
        </ScrollHint>
        <div className="mt-3 flex h-[var(--control-h)] items-center justify-between gap-2">
          {footer}
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            aria-busy={isPending}
            className={cn(CONTROL, "shrink-0 px-4")}
            title="Strg+Enter"
          >
            {SUBMIT[tab]}
          </Button>
        </div>
      </div>
    </div>
  );
}
