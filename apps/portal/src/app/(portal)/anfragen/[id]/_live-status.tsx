"use client";

import { AlarmClock, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@eins/ui";
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
import { rowTiming, statusImpliesContact, type RowTiming } from "../_lib/row-timing";
import { formatDeadlineShort } from "../_lib/deadline";
import { describeTiming } from "../_components/TimingLine";
import {
  DEADLINE_RUNNING_HINT,
  LATE_HINT,
  NOT_ANSWERED_HINT,
  OVERDUE_HINT,
} from "../_lib/response-hints";
import type { FollowupRow } from "@/server/queries/followups";
import { formatDuration } from "./_duration";
import { Fact, Missing } from "./_fact";
import { DETAIL_FACT_COLUMNS } from "./_lib/sizes";
import { useFollowups, usePending, usePendingStatus, type ActivityItem } from "./_pending";

/** What the server knows about the Anfrage's clock, and what it computed from it. */
export type ClockInput = {
  createdAt: Date;
  firstContactedAt: Date | null;
  firstAttemptAt: Date | null;
  slaRespondBy: Date | null;
  rule: PraxisResponseRule;
  status: string;
  server: {
    timing: RowTiming | null;
    response: ResponseInfo;
    slaBreached: boolean;
    contactImplied: boolean;
  };
};

/** Same rule as the server's first attempt (firstAttemptAtSql). */
function isAttempt(a: ActivityItem): boolean {
  if (a.kind === "call" || a.kind === "email" || a.kind === "whatsapp") return true;
  if (a.kind !== "status_change") return false;
  const to = !!a.meta && typeof a.meta === "object" ? (a.meta as { to?: unknown }).to : null;
  return typeof to === "string" && !["spam", "verloren", "neu"].includes(to);
}

/**
 * The server's values as long as nothing is saving (no clock read on
 * hydration). While a call, a message or a status is on its way they are
 * counted again with it, so "Überfällig" goes away on the tap.
 */
function useClock(c: ClockInput) {
  const { changes } = usePending();
  const pendingStatus = usePendingStatus();
  if (changes.length === 0) return { ...c.server, contactAt: c.firstContactedAt, attemptAt: c.firstAttemptAt };

  const attemptAt =
    c.firstAttemptAt ?? changes.flatMap((x) => x.activities ?? []).find(isAttempt)?.createdAt ?? null;
  const status = pendingStatus ?? c.status;
  const contactAt = c.firstContactedAt ?? changes.find((x) => x.contact)?.at ?? null;
  const now = new Date();
  const response = responseInfo({ createdAt: c.createdAt, firstAttemptAt: attemptAt, status, ...c.rule }, now);
  const contactImplied = statusImpliesContact(status) && !attemptAt;
  const timing = rowTiming(
    {
      createdAt: c.createdAt,
      firstAttemptAt: attemptAt,
      status,
      ...c.rule,
      firstContactedAt: contactAt,
      slaRespondBy: c.slaRespondBy,
    },
    now
  );
  return {
    timing,
    response,
    slaBreached: c.server.slaBreached && !contactImplied && !contactAt,
    contactImplied,
    contactAt,
    attemptAt,
  };
}

/** The icon of a timing, one line tall (as in `TimingLine`). */
function TimingIcon({ urgent, tone }: { urgent: boolean; tone: "bad" | "warn" | "neutral" }) {
  const Icon = urgent ? AlertTriangle : Clock;
  return (
    <span aria-hidden className="flex h-5 shrink-0 items-center">
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          tone === "bad" ? "text-tone-bad" : tone === "warn" ? "text-tone-warn" : "text-fg-secondary"
        )}
      />
    </span>
  );
}

function Hints({ term, hints }: { term: string; hints: string[] }) {
  return (
    <ExplainerPopover term={term} ariaLabel={`Erklärung: ${term}`}>
      {hints.map((h, i) => (
        <p key={i} className={i > 0 ? "mt-2" : undefined}>
          {h}
        </p>
      ))}
    </ExplainerPopover>
  );
}

/**
 * "Frist" in the record: what is due and by when, in two lines, from the
 * same `rowTiming` as the list and the call card, so the page never says
 * something else than the row it was opened from.
 */
export function LiveFristFact({ clock }: { clock: ClockInput }) {
  const { timing, contactAt, attemptAt, contactImplied } = useClock(clock);

  if (!timing) {
    return (
      <Fact label="Frist" lines={2}>
        <span className="block">Keine offene Frist</span>
        <span className="block h-5 text-sm text-fg-secondary">
          {contactAt
            ? `Kontakt am ${formatDateTime(contactAt)}`
            : attemptAt
              ? `Erster Versuch am ${formatDateTime(attemptAt)}`
              : contactImplied
                ? "Laut Status erreicht"
                : "Kein Kontakt eingetragen"}
        </span>
      </Fact>
    );
  }

  const { text, hints, urgent, tone } = describeTiming(timing);
  if (timing.kind === "flag") {
    // The contract's wording, whole: it may take both lines.
    return (
      <Fact label="Frist" lines={2} wrap>
        <span className="flex items-start gap-1.5 font-medium">
          <TimingIcon urgent={urgent} tone={tone} />
          <span className="min-w-0">
            {text}
            <Hints term={text} hints={hints} />
          </span>
        </span>
      </Fact>
    );
  }
  return (
    <Fact label="Frist" lines={2}>
      <span className="flex h-5 items-center gap-1.5 font-medium">
        <TimingIcon urgent={urgent} tone={tone} />
        {timing.kind === "deadline" && timing.late && <span className="sr-only">Rückruf-Ziel verpasst. </span>}
        {timing.kind === "deadline" ? "Kontaktieren bis" : text}
        <Hints term={timing.kind === "deadline" ? "Frist" : text} hints={hints} />
      </span>
      <span className="block h-5 tabular-nums">
        {timing.kind === "deadline"
          ? formatDeadlineShort(timing.deadline)
          : clock.slaRespondBy
            ? <span className="text-sm text-fg-secondary">seit {formatDeadlineShort(clock.slaRespondBy)}</span>
            : null}
      </span>
    </Fact>
  );
}

/** "Wiedervorlage" in the record: the next open one, with what is still saving. */
export function LiveNextFollowupFact({ requestId, followups }: { requestId: string; followups: FollowupRow[] }) {
  const merged = useFollowups(requestId, followups);
  const next = merged.find((f) => f.status === "pending") ?? null;
  if (!next) {
    return (
      <Fact label="Wiedervorlage" lines={2}>
        <Missing>Keine</Missing>
      </Fact>
    );
  }
  const due = next.dueAt.getTime() <= Date.now();
  return (
    <Fact label="Wiedervorlage" lines={2}>
      <span className="flex h-5 items-center gap-1.5 tabular-nums">
        {due && <AlarmClock className="h-4 w-4 shrink-0 text-tone-warn" aria-hidden />}
        {formatDeadlineShort(next.dueAt)}
      </span>
      <span className="block h-5 text-sm text-fg-secondary">
        {due && <span className="font-medium text-fg-primary">Fällig</span>}
        {due && next.note && " · "}
        {next.note}
      </span>
    </Fact>
  );
}

/**
 * The Details card's "Frist und Kontakt": first contact, reaction time, the
 * internal Rückruf-Ziel and the 48-Werkstunden-Frist with its state, each
 * with its explanation. Counted with what is still saving, like the record.
 */
export function LiveTimeFacts({ clock }: { clock: ClockInput }) {
  const { response, slaBreached, contactImplied, contactAt } = useClock(clock);
  const responseFlagged = isPraxisResponseFlag(response.state);
  const responseHint =
    response.state === "nicht_beantwortet"
      ? NOT_ANSWERED_HINT
      : response.state === "zu_spaet"
        ? LATE_HINT
        : DEADLINE_RUNNING_HINT;
  const showDeadline = !!response.deadline && response.state !== "ausgenommen" && !contactImplied;
  const StateIcon = responseFlagged ? AlertTriangle : response.state === "rechtzeitig" ? CheckCircle2 : Clock;

  return (
    <>
      <Fact label="Erstkontakt" columns={DETAIL_FACT_COLUMNS}>
        {contactAt ? (
          <span className="tabular-nums">{formatDateTime(contactAt)}</span>
        ) : (
          <Missing>{contactImplied ? "Laut Status erreicht" : "Noch keiner"}</Missing>
        )}
      </Fact>
      <Fact label="Reaktionszeit" columns={DETAIL_FACT_COLUMNS}>
        {contactAt ? (
          <span className="tabular-nums">{formatDuration(contactAt.getTime() - clock.createdAt.getTime())}</span>
        ) : (
          <Missing>Noch kein Kontakt</Missing>
        )}
      </Fact>
      <Fact
        label={
          <span className="inline-flex items-center">
            Rückruf-Ziel ({SLA_HOURS} Std.)
            <ExplainerPopover term="Rückruf-Ziel" ariaLabel="Erklärung zu Rückruf-Ziel">
              {OVERDUE_HINT}
            </ExplainerPopover>
          </span>
        }
        lines={2}
        columns={DETAIL_FACT_COLUMNS}
      >
        {clock.slaRespondBy ? (
          <>
            <span className="block tabular-nums">{formatDateTime(clock.slaRespondBy)}</span>
            <span className="flex h-5 items-center gap-1.5 text-sm font-medium">
              {slaBreached && (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-tone-bad" aria-hidden />
                  Überfällig
                </>
              )}
            </span>
          </>
        ) : (
          <Missing>Keines</Missing>
        )}
      </Fact>
      <Fact
        label={
          <span className="inline-flex items-center">
            48-Werkstunden-Frist
            <ExplainerPopover term="48 Werkstunden" ariaLabel="Erklärung zu 48 Werkstunden">
              {responseHint}
            </ExplainerPopover>
          </span>
        }
        lines={2}
        columns={DETAIL_FACT_COLUMNS}
      >
        <span className="block tabular-nums">
          {showDeadline && response.deadline ? `${formatBerlinDateTime(response.deadline)} Uhr` : <Missing>Keine</Missing>}
        </span>
        <span className="flex h-5 items-center gap-1.5 text-sm font-medium">
          <StateIcon
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              responseFlagged ? "text-tone-bad" : response.state === "rechtzeitig" ? "text-tone-good" : "text-fg-secondary"
            )}
          />
          {contactImplied && !showDeadline ? "Laut Status erreicht" : RESPONSE_STATE_LABELS[response.state]}
        </span>
      </Fact>
    </>
  );
}
