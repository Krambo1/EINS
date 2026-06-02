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
  MessageSquarePlus,
  ArrowRightLeft,
  CalendarClock,
  Loader2,
  Lock,
} from "lucide-react";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  REQUEST_STATUS_LABELS,
  STATUS_TRANSITIONS,
  type CallOutcome,
  type RequestStatus,
} from "@/lib/constants";
import { logCall, addNote, changeStatus, scheduleFollowup } from "./actions";

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
}: {
  requestId: string;
  currentStatus: string;
  pvsControlled: boolean;
}) {
  const transitions = STATUS_TRANSITIONS[currentStatus as RequestStatus] ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CallDialog
        requestId={requestId}
        currentStatus={currentStatus}
        transitions={transitions}
        pvsControlled={pvsControlled}
      />
      <NoteDialog requestId={requestId} />
      <StatusDialog
        requestId={requestId}
        transitions={transitions}
        pvsControlled={pvsControlled}
      />
      <FollowupDialog requestId={requestId} />
    </div>
  );
}

/** Shared error/submit hook for the dialogs. */
function useAction(onDone: () => void) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: (fd: FormData) => Promise<void>, fd: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await action(fd);
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Aktion fehlgeschlagen.");
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

function CallDialog({
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
  const [outcome, setOutcome] = useState<CallOutcome>("erreicht");
  const [note, setNote] = useState("");
  const [statusAfter, setStatusAfter] = useState<string>(KEEP);
  const [followupAt, setFollowupAt] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const { isPending, error, setError, run } = useAction(() => {
    setOpen(false);
    setNote("");
    setFollowupAt("");
    setFollowupNote("");
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
    if (statusAfter !== KEEP) fd.set("statusAfter", statusAfter);
    if (followupAt) {
      fd.set("followupAt", followupAt);
      if (followupNote.trim()) fd.set("followupNote", followupNote);
    }
    run(logCall, fd);
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
            <Textarea
              rows={3}
              maxLength={5000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. Patient:in meldet sich nächste Woche selbst."
            />
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
            <Button variant="outline" disabled={isPending}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
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
  const { isPending, error, setError, run } = useAction(() => {
    setOpen(false);
    setNote("");
  });

  const submit = () => {
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("note", note);
    run(addNote, fd);
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
          <Textarea
            rows={4}
            maxLength={5000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Interne Notiz zum Verlauf dieser Anfrage."
            autoFocus
          />
          <ErrorLine message={error} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending || !note.trim()}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  requestId,
  transitions,
  pvsControlled,
}: {
  requestId: string;
  transitions: readonly RequestStatus[];
  pvsControlled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>("");
  const { isPending, error, setError, run } = useAction(() => {
    setOpen(false);
    setStatus("");
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
    run(changeStatus, fd);
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
            <Button variant="outline" disabled={isPending}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending || !status}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
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
  const { isPending, error, setError, run } = useAction(() => {
    setOpen(false);
    setDueAt("");
    setNote("");
  });

  const submit = () => {
    if (!dueAt) return;
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("dueAt", dueAt);
    if (note.trim()) fd.set("note", note);
    run(scheduleFollowup, fd);
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
            <Button variant="outline" disabled={isPending}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={isPending || !dueAt}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Planen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
