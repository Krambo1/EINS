"use client";

import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { useState, useTransition } from "react";
import { X } from "lucide-react";

import type { AlertSeverity } from "@/server/queries/anomalies";
import { showActionFlash } from "../../_components/flash-event";
import { dismissAlertAction, snoozeAlertAction } from "./anomaly-actions";
import { CONTROL, CONTROL_SQUARE, DashCard } from "./dash-ui";

export interface AlertRowData {
  id: string;
  title: string;
  severity: AlertSeverity;
  actionSteps: string[];
  aiActionSteps: string[] | null;
}

type Kind = "dismiss" | "snooze";

/**
 * The alerts card. A tap on "Ausblenden" or "In 7 Tagen erinnern" takes
 * the alert off the screen at once and saves in the background; a failed
 * save brings it back with a toast, a saved one confirms in the toast. The
 * alerts render once in the page shell (outside the per-period views), so
 * one hidden set here is enough. Once the revalidated list lands without the
 * alert, the hidden id is simply redundant.
 */
export function AlertsCard({ alerts }: { alerts: AlertRowData[] }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [, startTransition] = useTransition();

  const visible = alerts.filter((a) => !hidden.has(a.id));
  if (visible.length === 0) return null;

  function act(id: string, kind: Kind) {
    setHidden((prev) => new Set(prev).add(id));
    const fd = new FormData();
    fd.set("alertId", id);
    const restore = () =>
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    startTransition(async () => {
      try {
        await (kind === "dismiss" ? dismissAlertAction(fd) : snoozeAlertAction(fd));
        showActionFlash(
          kind === "dismiss"
            ? { tone: "good", title: "Ausgeblendet" }
            : { tone: "good", title: "Wir erinnern Sie in 7 Tagen" }
        );
      } catch {
        restore();
        showActionFlash({
          tone: "bad",
          title: "Nicht gespeichert",
          description: "Die Auffälligkeit ist wieder da. Prüfen Sie die Verbindung und tippen Sie noch einmal.",
        });
      }
    });
  }

  return (
    <DashCard
      title="Auffälligkeiten"
      titleExtra={
        <ExplainerPopover term="Auffälligkeiten" ariaLabel="Erklärung für Auffälligkeiten">
          <p>
            Kennzahlen, die in den letzten Tagen deutlich von Ihren üblichen
            Werten abweichen.
          </p>
        </ExplainerPopover>
      }
    >
      {/* Each alert is a tile standing on the card, nothing between them.
          White on the white card, so the tile carries the card's own drop
          shadow and hover (elev-card lift, as DashCard), not the small raised
          one: with that it read flat (Karam, 2026-11-03; a grey well behind the tiles was rejected
          as cards in cards). Two per row from md up on the page grid
          (gap-x-6), one on the phone. From md every tile spans two rows of
          the list's grid (subgrid), so head and steps of two tiles side by
          side share their heights and the hairline runs level. The space
          between tile rows is the tiles' bottom margin, taken back once at
          the end. */}
      <ul className="flex flex-col gap-4 md:-mb-6 md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-0">
        {visible.map((a) => (
          <AlertTile key={a.id} alert={a} onAct={(kind) => act(a.id, kind)} />
        ))}
      </ul>
    </DashCard>
  );
}

function AlertTile({
  alert,
  onAct,
}: {
  alert: AlertRowData;
  onAct: (kind: Kind) => void;
}) {
  const tone = severityTone(alert.severity);
  const hasRuleSteps = alert.actionSteps.length > 0;
  const hasAiSteps = (alert.aiActionSteps?.length ?? 0) > 0;
  const showSteps = hasRuleSteps || hasAiSteps;

  // Two sections parted by a full-width hairline (DESIGN.md §5): the head
  // (dot, headline, "7d" and X at the right) and the steps. Headline as a row
  // name (15 px), below the card title; steps in body size with one fixed
  // marker slot, so bullet and "KI" steps start on one line.
  return (
    <li className="elev-card lift flex min-w-0 flex-col rounded-[var(--r-panel)] bg-[var(--surface-raised)] md:row-span-2 md:mb-6 md:grid md:grid-rows-subgrid md:gap-0">
      <div
        className={`flex items-start gap-3 p-4 ${showSteps ? "border-b border-border" : ""}`}
      >
        <span
          aria-hidden
          className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${tone.dotClass}`}
        />
        <p className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-fg-primary">
          {alert.title}
        </p>
        {/* Snooze and hide side by side. What "7d" does is in the browser's
            own tooltip (title), nothing custom. */}
        <div className="-my-2.5 -mr-2.5 flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onAct("snooze")}
            aria-label="In 7 Tagen erinnern"
            title="In 7 Tagen erinnern"
            className={`${CONTROL} opa-focus-ring inline-flex items-center px-2 text-sm font-medium tabular-nums text-fg-tertiary hover:bg-[var(--hover-wash)] hover:text-fg-primary`}
          >
            7d
          </button>
          <button
            type="button"
            onClick={() => onAct("dismiss")}
            aria-label="Auffälligkeit ausblenden"
            title="Ausblenden"
            className={`${CONTROL} ${CONTROL_SQUARE} opa-focus-ring inline-flex items-center justify-center text-fg-tertiary hover:bg-[var(--hover-wash)] hover:text-fg-primary`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showSteps ? (
        <div className="p-4">
          <ul className="flex flex-col gap-1.5 text-[15px] leading-6 text-fg-primary">
            {alert.actionSteps.map((step, idx) => (
              <li key={`rule-${idx}`} className="flex">
                <span aria-hidden className={`${STEP_MARK} text-fg-tertiary`}>
                  •
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
            {alert.aiActionSteps?.map((step, idx) => (
              <li key={`ai-${idx}`} className="flex">
                <span
                  className={`${STEP_MARK} text-sm font-medium text-fg-tertiary`}
                  title="Von KI ergänzt, weil der Fall ungewöhnlich ist"
                >
                  KI
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // Keeps the two grid rows when an alert has nothing to do.
        <div aria-hidden />
      )}

    </li>
  );
}

/**
 * Fixed slot before each step: the bullet or "KI", in the column of the dot
 * above (dot 10 px + gap 12 px), so every step starts where the headline does.
 */
const STEP_MARK = "w-[1.375rem] shrink-0";

function severityTone(severity: AlertSeverity): { dotClass: string } {
  switch (severity) {
    case "extreme":
      return { dotClass: "bg-tone-bad ring-2 ring-[var(--tone-bad-border)]" };
    case "high":
      return { dotClass: "bg-tone-bad" };
    case "warn":
      return { dotClass: "bg-tone-warn" };
    case "info":
    default:
      return { dotClass: "bg-fg-tertiary" };
  }
}
