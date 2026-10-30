"use client";

import { useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@eins/ui";
import {
  Phone,
  PhoneCall,
  MessageSquarePlus,
  ArrowRightLeft,
  CalendarClock,
  Lock,
  Mail,
} from "lucide-react";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  REQUEST_STATUS_LABELS,
  STATUS_TRANSITIONS,
  type CallOutcome,
  type RequestStatus,
} from "@/lib/constants";
import {
  logCall,
  logMessage,
  addNote,
  changeStatus,
  scheduleFollowup,
  type ActionResult,
} from "./actions";
import { followupInputError } from "./_followup-date";
import { parseBerlinLocalInput } from "../_lib/berlin-input";
import { showActionFlash } from "../../_components/flash-event";
import { formatDateTime } from "@/lib/formatting";
import {
  newActivity,
  pendingId,
  usePending,
  usePendingStatus,
  type PendingChange,
} from "./_pending";
import { ScrollHint } from "@/app/_components/ScrollHint";

const KEEP = "__keep__";

/** Outcome → suggested working status (only applied if it's a legal move). */
const OUTCOME_STATUS_SUGGESTION: Record<CallOutcome, RequestStatus> = {
  erreicht: "kontaktiert",
  nicht_erreicht: "nicht_erreicht",
  mailbox: "nicht_erreicht",
  falsche_nummer: "verloren",
};

/**
 * The working surface for a pre-booking lead. Shown to every clinic role
 * (reuses `requests.update`). When the lead is linked to a PVS appointment,
 * the status control is locked (the PVS owns the lifecycle) while calls,
 * notes and Wiedervorlagen stay available.
 */
export function LeadCockpit({
  requestId,
  currentStatus,
  pvsControlled,
  contactPhone = null,
  contactEmail = null,
}: {
  requestId: string;
  currentStatus: string;
  pvsControlled: boolean;
  /** For the phone action bar (below `md`): one tap to call, one to log it. */
  contactPhone?: string | null;
  contactEmail?: string | null;
}) {
  // A status that is still saving counts: the next dialog starts from it.
  const pendingStatus = usePendingStatus();
  const status = pendingStatus ?? currentStatus;
  const transitions = STATUS_TRANSITIONS[status as RequestStatus] ?? [];
  // Lifted so the phone action bar can open the same dialog.
  const [callOpen, setCallOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CallDialog
        requestId={requestId}
        currentStatus={status}
        transitions={transitions}
        pvsControlled={pvsControlled}
        open={callOpen}
        onOpenChange={setCallOpen}
      />
      <MobileActionBar
        contactPhone={contactPhone}
        contactEmail={contactEmail}
        onLogCall={() => setCallOpen(true)}
      />
      <MessageDialog requestId={requestId} />
      <NoteDialog requestId={requestId} />
      <StatusDialog
        requestId={requestId}
        currentStatus={status}
        transitions={transitions}
        pvsControlled={pvsControlled}
      />
      <FollowupDialog requestId={requestId} />
    </div>
  );
}

const OFFLINE = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";

/**
 * Shared submit hook for the dialogs (optimistic). After the checks, `run`
 * closes the dialog at once and puts the change on the page (`change`, see
 * _pending.tsx) while the action runs in the background. The form is cleared
 * at once (`clear` empties the fields and returns a function that puts the
 * input back), so a dialog opened again meanwhile starts empty and nothing
 * typed there is lost. Saved: a toast. Not saved: the change drops away, the
 * input comes back, the dialog opens again and a toast says why. `error` is
 * only for the checks that run before anything is sent.
 */
function useSave(setOpen: (open: boolean) => void, clear: () => () => void) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { add } = usePending();
  const run = (
    action: (fd: FormData) => Promise<ActionResult>,
    fd: FormData,
    change: PendingChange,
    savedTitle: string
  ) => {
    setError(null);
    setOpen(false);
    const restore = clear();
    startTransition(async () => {
      add(change);
      const failed = (description: string) => {
        restore();
        setOpen(true);
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description });
      };
      try {
        const res = await action(fd);
        if (res.ok) {
          showActionFlash({ tone: "good", title: savedTitle });
        } else {
          failed(res.message);
        }
      } catch {
        failed(OFFLINE);
      }
    });
  };
  return { isPending, error, setError, run };
}

const FIELD =
  "w-full rounded-xl border border-border bg-bg-primary px-3 py-2 text-sm text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-sm font-medium text-fg-primary">
      {children}
    </span>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-tone-bad">{message}</p>;
}

function StatusOptions({ transitions }: { transitions: readonly RequestStatus[] }) {
  return (
    <>
      <SelectItem value={KEEP}>Status nicht ändern</SelectItem>
      {transitions.map((s) => (
        <SelectItem key={s} value={s}>
          {REQUEST_STATUS_LABELS[s]}
        </SelectItem>
      ))}
    </>
  );
}

/**
 * Phone only (below `md`): Anrufen plus the next step (log the call) stay
 * reachable without scrolling. Fixed to the bottom, above the safe-area
 * inset; the page adds bottom padding so it never covers the last content.
 * On larger screens the contact row and this cockpit carry these actions.
 */
export function MobileActionBar({
  contactPhone,
  contactEmail,
  onLogCall,
}: {
  contactPhone: string | null;
  contactEmail: string | null;
  onLogCall?: () => void;
}) {
  const primary = contactPhone ? (
    <Button asChild size="lg" className="w-full justify-center">
      <a href={`tel:${contactPhone}`}>
        <Phone className="h-5 w-5" />
        Anrufen
      </a>
    </Button>
  ) : contactEmail ? (
    <Button asChild size="lg" className="w-full justify-center">
      <a href={`mailto:${contactEmail}`}>
        <Mail className="h-5 w-5" />
        E-Mail schreiben
      </a>
    </Button>
  ) : null;
  if (!primary && !onLogCall) return null;
  return (
    <div
      role="region"
      aria-label="Schnellaktionen"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg-primary px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] md:hidden"
    >
      <div className={`grid gap-2 ${primary && onLogCall ? "grid-cols-2" : "grid-cols-1"}`}>
        {primary}
        {onLogCall && (
          <Button
            size="lg"
            variant="outline"
            className="w-full justify-center"
            onClick={onLogCall}
          >
            <PhoneCall className="h-5 w-5" />
            Protokollieren
          </Button>
        )}
      </div>
    </div>
  );
}

function CallDialog({
  requestId,
  currentStatus,
  transitions,
  pvsControlled,
  open,
  onOpenChange: setOpen,
}: {
  requestId: string;
  currentStatus: string;
  transitions: readonly RequestStatus[];
  pvsControlled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome>("erreicht");
  const [note, setNote] = useState("");
  const [statusAfter, setStatusAfter] = useState<string>(KEEP);
  const [followupAt, setFollowupAt] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const { actor } = usePending();
  const { isPending, error, setError, run } = useSave(setOpen, () => {
    const saved = { note, statusAfter, followupAt, followupNote };
    setNote("");
    setStatusAfter(KEEP);
    setFollowupAt("");
    setFollowupNote("");
    return () => {
      setNote(saved.note);
      setStatusAfter(saved.statusAfter);
      setFollowupAt(saved.followupAt);
      setFollowupNote(saved.followupNote);
    };
  });

  // Suggest a status when the outcome changes — only if it's a legal move and
  // the status isn't PVS-locked. Leaves the MFA free to override.
  const onOutcomeChange = (value: string) => {
    const next = value as CallOutcome;
    setOutcome(next);
    if (pvsControlled) {
      setStatusAfter(KEEP);
      return;
    }
    const suggestion = OUTCOME_STATUS_SUGGESTION[next];
    setStatusAfter(
      suggestion && suggestion !== currentStatus && transitions.includes(suggestion)
        ? suggestion
        : KEEP
    );
  };

  const submit = () => {
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("outcome", outcome);
    if (note.trim()) fd.set("note", note);
    if (statusAfter !== KEEP) {
      fd.set("statusAfter", statusAfter);
      fd.set("expectedStatus", currentStatus);
    }
    if (followupAt) {
      const dateError = followupInputError(followupAt);
      if (dateError) {
        setError(dateError);
        return;
      }
      fd.set("followupAt", followupAt);
      if (followupNote.trim()) fd.set("followupNote", followupNote);
    }

    // What the page shows while this saves: the call, the status change and
    // the Wiedervorlage with its Verlauf note, as the server writes them.
    const at = new Date();
    const activities = [newActivity(actor, at, "call", note.trim() || null, { outcome })];
    const change: PendingChange = { at, activities, contact: true };
    if (statusAfter !== KEEP && statusAfter !== currentStatus) {
      activities.push(
        newActivity(actor, at, "status_change", null, { from: currentStatus, to: statusAfter })
      );
      change.status = statusAfter as RequestStatus;
    }
    const due = followupAt ? parseBerlinLocalInput(followupAt) : null;
    if (due) {
      const dueNote = followupNote.trim() || null;
      change.followup = { id: pendingId(), dueAt: due, note: dueNote };
      activities.push(
        newActivity(actor, at, "note", `Wiedervorlage für ${formatDateTime(due)}${dueNote ? `: ${dueNote}` : ""}`)
      );
    }
    run(logCall, fd, change, "Anruf gespeichert");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <Button size="sm" onClick={() => setOpen(true)}>
        <Phone className="h-4 w-4" />
        Anruf protokollieren
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anruf protokollieren</DialogTitle>
          <DialogDescription>
            Halten Sie fest, was beim Anruf herauskam. Status und Wiedervorlage
            können Sie gleich mit erledigen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <FieldLabel>Ergebnis</FieldLabel>
            <Select value={outcome} onValueChange={onOutcomeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALL_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {CALL_OUTCOME_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <FieldLabel>Notiz (optional)</FieldLabel>
            <ScrollHint watch={note}>
              <Textarea
                rows={3}
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="z. B. Patient meldet sich nächste Woche selbst."
              />
            </ScrollHint>
          </div>

          <div>
            <FieldLabel>Status</FieldLabel>
            {pvsControlled ? (
              <p className="inline-flex items-center gap-1.5 rounded-lg bg-bg-secondary px-3 py-2 text-sm text-fg-secondary">
                <Lock className="h-4 w-4" />
                Status wird von Ihrer PVS gesteuert.
              </p>
            ) : (
              <Select value={statusAfter} onValueChange={setStatusAfter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <StatusOptions transitions={transitions} />
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <FieldLabel>Wiedervorlage (optional)</FieldLabel>
            <input
              type="datetime-local"
              className={FIELD}
              value={followupAt}
              onChange={(e) => setFollowupAt(e.target.value)}
            />
            {followupAt && (
              <input
                className={`${FIELD} mt-2`}
                value={followupNote}
                onChange={(e) => setFollowupNote(e.target.value)}
                maxLength={2000}
                placeholder="Worum geht es beim Rückruf?"
              />
            )}
          </div>

          <ErrorLine message={error} />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** K-20: a sent e-mail / WhatsApp message, logged as a contact attempt. */
function MessageDialog({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [note, setNote] = useState("");
  const { actor } = usePending();
  const { isPending, error, setError, run } = useSave(setOpen, () => {
    const saved = note;
    setNote("");
    return () => setNote(saved);
  });

  const submit = () => {
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("channel", channel);
    if (note.trim()) fd.set("note", note);
    const at = new Date();
    run(
      logMessage,
      fd,
      { at, activities: [newActivity(actor, at, channel, note.trim() || null)], contact: true },
      "Nachricht vermerkt"
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Mail className="h-4 w-4" />
        Nachricht vermerken
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gesendete Nachricht vermerken</DialogTitle>
          <DialogDescription>
            Sie haben der Person eine E-Mail oder WhatsApp-Nachricht geschrieben?
            Das zählt als Kontaktversuch.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <FieldLabel>Gesendet per</FieldLabel>
            <Select
              value={channel}
              onValueChange={(v) => setChannel(v as "email" | "whatsapp")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">E-Mail</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <FieldLabel>Notiz (optional)</FieldLabel>
            <ScrollHint watch={note}>
              <Textarea
                rows={3}
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Zum Beispiel: Terminvorschläge geschickt."
              />
            </ScrollHint>
          </div>
          <ErrorLine message={error} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { actor } = usePending();
  const { isPending, error, setError, run } = useSave(setOpen, () => {
    const saved = note;
    setNote("");
    return () => setNote(saved);
  });

  const submit = () => {
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("note", note);
    const at = new Date();
    run(addNote, fd, { at, activities: [newActivity(actor, at, "note", note)] }, "Notiz gespeichert");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="h-4 w-4" />
        Notiz
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notiz hinzufügen</DialogTitle>
          <DialogDescription>
            Interne Notiz, die im Verlauf dieser Anfrage erscheint.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ScrollHint watch={note}>
            <Textarea
              rows={4}
              maxLength={5000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Interne Notiz zum Verlauf dieser Anfrage."
              autoFocus
            />
          </ScrollHint>
          <ErrorLine message={error} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending || !note.trim()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  requestId,
  currentStatus,
  transitions,
  pvsControlled,
}: {
  requestId: string;
  currentStatus: string;
  transitions: readonly RequestStatus[];
  pvsControlled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>("");
  const { actor } = usePending();
  const { isPending, error, setError, run } = useSave(setOpen, () => {
    const saved = status;
    setStatus("");
    return () => setStatus(saved);
  });

  if (pvsControlled) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title="Status wird von Ihrer PVS gesteuert."
      >
        <Lock className="h-4 w-4" />
        Status ändern
      </Button>
    );
  }

  const submit = () => {
    if (!status) return;
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("status", status);
    fd.set("expectedStatus", currentStatus);
    const at = new Date();
    run(
      changeStatus,
      fd,
      {
        at,
        activities: [newActivity(actor, at, "status_change", null, { from: currentStatus, to: status })],
        status: status as RequestStatus,
        contact: currentStatus === "neu",
      },
      "Status geändert"
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={transitions.length === 0}
      >
        <ArrowRightLeft className="h-4 w-4" />
        Status ändern
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Status ändern</DialogTitle>
          <DialogDescription>
            Neuen Bearbeitungsstatus für diese Anfrage wählen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Neuen Status wählen" />
            </SelectTrigger>
            <SelectContent>
              {transitions.map((s) => (
                <SelectItem key={s} value={s}>
                  {REQUEST_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorLine message={error} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending || !status}>
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowupDialog({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const { actor } = usePending();
  const { isPending, error, setError, run } = useSave(setOpen, () => {
    const saved = { dueAt, note };
    setDueAt("");
    setNote("");
    return () => {
      setDueAt(saved.dueAt);
      setNote(saved.note);
    };
  });

  const submit = () => {
    const dateError = followupInputError(dueAt);
    if (dateError) {
      setError(dateError);
      return;
    }
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("dueAt", dueAt);
    if (note.trim()) fd.set("note", note);
    const at = new Date();
    const due = parseBerlinLocalInput(dueAt);
    const dueNote = note.trim() || null;
    run(
      scheduleFollowup,
      fd,
      due
        ? {
            at,
            followup: { id: pendingId(), dueAt: due, note: dueNote },
            activities: [
              newActivity(actor, at, "note", `Wiedervorlage für ${formatDateTime(due)}${dueNote ? `: ${dueNote}` : ""}`),
            ],
          }
        : { at },
      "Wiedervorlage geplant"
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4" />
        Wiedervorlage
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Wiedervorlage planen</DialogTitle>
          <DialogDescription>
            Legen Sie fest, wann diese Anfrage wieder oben in der Anrufliste
            auftauchen soll.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <FieldLabel>Fällig am</FieldLabel>
            <input
              type="datetime-local"
              className={FIELD}
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>Notiz (optional)</FieldLabel>
            <input
              className={FIELD}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              placeholder="Worum geht es beim Rückruf?"
            />
          </div>
          <ErrorLine message={error} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending}>
            Planen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
