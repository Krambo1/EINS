"use client";

import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { StatusPill } from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { formatDateTime } from "@/lib/formatting";
import { SLA_HOURS } from "@/lib/constants";
import {
  RESPONSE_STATE_LABELS,
  isPraxisResponseFlag,
  responseInfo,
  type PraxisResponseRule,
  type ResponseInfo,
} from "@/lib/response-time";
import { formatBerlinDateTime } from "@/lib/werkstunden";
import { statusImpliesContact } from "../_lib/row-timing";
import {
  DEADLINE_RUNNING_HINT,
  LATE_HINT,
  NOT_ANSWERED_HINT,
  OVERDUE_HINT,
} from "../_lib/response-hints";
import { formatDuration } from "./_duration";
import { useFollowups, usePending, usePendingStatus, type ActivityItem } from "./_pending";
import type { FollowupRow } from "@/server/queries/followups";

/**
 * The status in the head of the page. A status chosen in a dialog shows at
 * once; "Status aus der PVS" goes with it, because the new status is manual.
 */
export function LiveStatus({ status, fromPvs }: { status: string; fromPvs: boolean }) {
  const next = usePendingStatus();
  return (
    <>
      <StatusPill status={next ?? status} />
      {fromPvs && !next && <span>· Status aus der PVS</span>}
    </>
  );
}

function ProofStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-medium text-fg-primary">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-fg-primary">{value}</div>
    </div>
  );
}

/**
 * Reaktionszeit, Anrufversuche and next Wiedervorlage, counted with what is
 * still saving, so a logged call shows in the numbers when it shows in the
 * Verlauf.
 */
export function ProofStats({
  requestId,
  createdAt,
  firstContactedAt,
  callCount,
  followups,
}: {
  requestId: string;
  createdAt: Date;
  firstContactedAt: Date | null;
  callCount: number;
  followups: FollowupRow[];
}) {
  const { changes } = usePending();
  const merged = useFollowups(requestId, followups);

  const calls =
    callCount + changes.reduce((n, c) => n + (c.activities?.filter((a) => a.kind === "call").length ?? 0), 0);
  const contactAt = firstContactedAt ?? changes.find((c) => c.contact)?.at ?? null;
  const reactionMs = contactAt ? contactAt.getTime() - createdAt.getTime() : null;
  const next = merged.find((f) => f.status === "pending") ?? null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <ProofStat label="Reaktionszeit" value={reactionMs != null ? formatDuration(reactionMs) : "Noch kein Kontakt"} />
      <ProofStat label="Anrufversuche" value={calls === 0 ? "Noch keine" : String(calls)} />
      <ProofStat label="Nächste Wiedervorlage" value={next ? formatDateTime(next.dueAt) : "Keine"} />
    </div>
  );
}

/** Same rule as the server's first attempt (firstAttemptAtSql). */
function isAttempt(a: ActivityItem): boolean {
  if (a.kind === "call" || a.kind === "email" || a.kind === "whatsapp") return true;
  if (a.kind !== "status_change") return false;
  const to = !!a.meta && typeof a.meta === "object" ? (a.meta as { to?: unknown }).to : null;
  return typeof to === "string" && !["spam", "verloren", "neu"].includes(to);
}

/**
 * Eingegangen, Erstkontakt, Rückruf-Ziel and the 48-Werkstunden-Frist. The
 * server's values as long as nothing is saving (no clock read on hydration);
 * while a call, a message or a status is on its way they are counted again
 * with it, so "Überfällig" goes away on the tap, like the status above.
 */
export function LiveTimeFacts({
  createdAt,
  firstContactedAt,
  firstAttemptAt,
  slaRespondBy,
  rule,
  status,
  serverResponse,
  serverSlaBreached,
  serverContactImplied,
}: {
  createdAt: Date;
  firstContactedAt: Date | null;
  firstAttemptAt: Date | null;
  slaRespondBy: Date | null;
  rule: PraxisResponseRule;
  status: string;
  serverResponse: ResponseInfo;
  serverSlaBreached: boolean;
  serverContactImplied: boolean;
}) {
  const { changes } = usePending();
  const pendingStatus = usePendingStatus();

  let contactAt = firstContactedAt;
  let response = serverResponse;
  let slaBreached = serverSlaBreached;
  let contactImplied = serverContactImplied;
  if (changes.length > 0) {
    const attemptAt =
      firstAttemptAt ?? changes.flatMap((c) => c.activities ?? []).find(isAttempt)?.createdAt ?? null;
    const nowStatus = pendingStatus ?? status;
    contactAt = firstContactedAt ?? changes.find((c) => c.contact)?.at ?? null;
    response = responseInfo({ createdAt, firstAttemptAt: attemptAt, status: nowStatus, ...rule }, new Date());
    contactImplied = statusImpliesContact(nowStatus) && !attemptAt;
    slaBreached = serverSlaBreached && !contactImplied && !contactAt;
  }

  const responseFlagged = isPraxisResponseFlag(response.state);
  const responseHint =
    response.state === "nicht_beantwortet"
      ? NOT_ANSWERED_HINT
      : response.state === "zu_spaet"
      ? LATE_HINT
      : DEADLINE_RUNNING_HINT;

  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
      <TimeFact label="Eingegangen" value={formatDateTime(createdAt)} />
      {contactAt && <TimeFact label="Erstkontakt" value={formatDateTime(contactAt)} />}
      {slaRespondBy && (
        <TimeFact
          label={`Rückruf-Ziel (${SLA_HOURS} Stunden)`}
          value={formatDateTime(slaRespondBy)}
          status={slaBreached ? "Überfällig" : null}
          statusTone="bad"
          hintTerm="Rückruf-Ziel"
          hint={OVERDUE_HINT}
        />
      )}
      {response.deadline && response.state !== "ausgenommen" && !contactImplied && (
        <TimeFact
          label="48-Werkstunden-Frist"
          value={formatBerlinDateTime(response.deadline)}
          status={RESPONSE_STATE_LABELS[response.state]}
          statusTone={responseFlagged ? "bad" : response.state === "rechtzeitig" ? "good" : "default"}
          hintTerm={responseFlagged ? RESPONSE_STATE_LABELS[response.state] : "48 Werkstunden"}
          hint={responseHint}
        />
      )}
    </dl>
  );
}

function TimeFact({
  label,
  value,
  status = null,
  statusTone = "default",
  hint,
  hintTerm,
}: {
  label: string;
  value: string;
  status?: string | null;
  statusTone?: "default" | "good" | "bad";
  hint?: string;
  hintTerm?: string;
}) {
  // Same pattern as the timing line in the lists: icon first, dark text.
  const Icon = statusTone === "bad" ? AlertTriangle : statusTone === "good" ? CheckCircle2 : Clock;
  const iconClass =
    statusTone === "bad" ? "text-tone-bad" : statusTone === "good" ? "text-tone-good" : "text-fg-secondary";
  return (
    <div className="min-w-0">
      <dt className="flex items-center text-sm font-medium text-fg-primary">
        {label}
        {hint && (
          <ExplainerPopover term={hintTerm ?? label} ariaLabel={`Erklärung zu ${hintTerm ?? label}`}>
            {hint}
          </ExplainerPopover>
        )}
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-fg-primary">{value}</dd>
      {status && (
        <dd className="flex items-start gap-1.5 text-sm font-medium text-fg-primary">
          <Icon aria-hidden className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${iconClass}`} />
          {status}
        </dd>
      )}
    </div>
  );
}
