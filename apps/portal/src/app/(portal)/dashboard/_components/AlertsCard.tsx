"use client";

import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { useState, useTransition } from "react";
import { X } from "lucide-react";

import type { AlertSeverity } from "@/server/queries/anomalies";
import { showActionFlash } from "../../_components/flash-event";
import { dismissAlertAction, snoozeAlertAction } from "./anomaly-actions";
import { DashCard } from "./dash-ui";

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
      bodyClassName="pt-1"
    >
      <ul className="divide-y divide-border">
        {visible.map((a) => (
          <li key={a.id} className="py-4 first:pt-2 last:pb-0">
            <AlertRow alert={a} onAct={(kind) => act(a.id, kind)} />
          </li>
        ))}
      </ul>
    </DashCard>
  );
}

function AlertRow({
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dotClass}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-fg-primary">{alert.title}</p>
            <button
              type="button"
              onClick={() => onAct("dismiss")}
              aria-label="Auffälligkeit ausblenden"
              title="Ausblenden"
              className="opa-focus-ring -mr-1 -mt-1 rounded-[var(--r-small)] p-1 text-fg-tertiary hover:bg-bg-tertiary hover:text-fg-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {showSteps && (
        <div className="ml-[1.375rem] flex flex-col gap-1.5">
          <p className="text-sm font-medium text-fg-primary">
            Nächste Schritte
          </p>
          <ul className="flex flex-col gap-1 text-sm text-fg-primary">
            {alert.actionSteps.map((step, idx) => (
              <li key={`rule-${idx}`} className="flex gap-2">
                <span aria-hidden className="text-fg-tertiary">
                  •
                </span>
                <span>{step}</span>
              </li>
            ))}
            {alert.aiActionSteps?.map((step, idx) => (
              <li key={`ai-${idx}`} className="flex gap-2">
                <span
                  aria-hidden
                  className="inline-flex h-5 shrink-0 items-center rounded-[var(--r-small)] border border-border px-1.5 text-xs font-medium text-fg-secondary"
                  title="Von KI ergänzt, weil der Fall ungewöhnlich ist"
                >
                  KI
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A hairline keeps what to do apart from the snooze. */}
      <div className="ml-[1.375rem] flex items-center gap-3 border-t border-border pt-3 text-sm text-fg-primary">
        <button
          type="button"
          onClick={() => onAct("snooze")}
          className="opa-focus-ring -ml-1 rounded-[var(--r-small)] px-1 py-0.5 underline-offset-2 hover:bg-bg-tertiary hover:underline"
        >
          In 7 Tagen erinnern
        </button>
      </div>
    </div>
  );
}

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
