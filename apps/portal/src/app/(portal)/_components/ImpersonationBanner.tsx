"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, cn } from "@eins/ui";
import { SECONDARY_BUTTON } from "../einstellungen/_components/settings-ui";
import { showActionFlash } from "./flash-event";
import { clearSearchStorage } from "./search-storage";

interface Props {
  targetEmail: string;
  clinicName: string;
  /** ISO end of the 30-minute admin view; null hides the remaining time. */
  expiresAt?: string | null;
}

/** "noch 23 Min." / "noch unter 1 Min." / "abgelaufen" (B-25 hard cap). */
export function remainingLabel(expiresAtMs: number, nowMs: number): string {
  const left = expiresAtMs - nowMs;
  if (left <= 0) return "abgelaufen";
  const min = Math.floor(left / 60_000);
  return min < 1 ? "noch unter 1 Min." : `noch ${min} Min.`;
}

/** Last five minutes (or over): the remaining time is shown in red. */
export function isEndingSoon(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs - nowMs <= 5 * 60_000;
}

/**
 * Top bar shown on every clinic-portal page when the active session was
 * opened by an admin via "View as user". It says plainly that the admin is
 * acting as this Praxis user right now, that every action is logged with the
 * admin id (audit_log.impersonated_by_admin_id, B-24), and how much of the
 * 30-minute view is left (B-25). Light amber tint, dark text. The "Beenden"
 * button POSTs to /api/auth/end-impersonation, which revokes the
 * session server-side and returns the admin host URL. We try
 * window.close() first (the tab was opened by JS, so the browser
 * permits it), then fall back to navigation.
 *
 * Laid out like the impersonation bars of Tradewing and Botdoc: the whole
 * width above everything, who you act as, the way out at the right end. It
 * keeps its size in every state (DESIGN.md section 10): ending and the last
 * five minutes change colour, not width; a failed end shows in the toast.
 */
export function ImpersonationBanner({ targetEmail, clinicName, expiresAt }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Client-only clock: rendering "now" on the server would mismatch on hydration.
  const [remaining, setRemaining] = useState<string | null>(null);
  const [endingSoon, setEndingSoon] = useState(false);
  // L-1: a customer view starts with an empty palette history in this browser.
  useEffect(() => {
    clearSearchStorage();
  }, []);
  useEffect(() => {
    const end = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(end)) return;
    const tick = () => {
      const now = Date.now();
      setRemaining(remainingLabel(end, now));
      setEndingSoon(isEndingSoon(end, now));
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  // A failed end goes to the toast like every failed action in the portal, in
  // German whatever the error said; the bar keeps its height.
  useEffect(() => {
    if (error) {
      showActionFlash({ tone: "bad", title: "Kundenansicht nicht beendet", description: "Bitte versuchen Sie es noch einmal." });
    }
  }, [error]);

  const onEnd = () => {
    setError(null);
    // L-1: nothing from this practice's palette survives the customer view.
    clearSearchStorage();
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/end-impersonation", {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        const data = (await res.json()) as { ok: boolean; redirectTo?: string };
        if (!data.ok || !data.redirectTo) {
          throw new Error("Kundenansicht konnte nicht beendet werden.");
        }
        // Try to close the tab (works because window.opener opened us).
        // If the close call is blocked (Firefox can be strict), navigate.
        window.close();
        setTimeout(() => {
          if (!window.closed) {
            window.location.href = data.redirectTo!;
          }
        }, 100);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler");
      }
    });
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] text-sm leading-5 text-fg-primary"
    >
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-6 md:px-6">
        {/* The address breaks where it must, never cut. */}
        <p className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-semibold">Kundenansicht</span> als{" "}
          <span className="font-medium">{targetEmail}</span>
          {clinicName ? <> ({clinicName})</> : null}. Jede Aktion wird mit Ihrer
          Admin-Kennung protokolliert.
        </p>
        {/* The time has its own slot (the longest, "Noch unter 1 Min.", fits),
            so the button never moves; on the phone the button sits right. */}
        <div className="flex shrink-0 items-center justify-between gap-4 md:justify-end">
          <span className={cn("font-medium tabular-nums md:min-w-[8.5rem] md:text-right", endingSoon && "text-tone-bad")}>
            {remaining ? remaining.charAt(0).toUpperCase() + remaining.slice(1) : null}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={onEnd}
            disabled={pending}
            aria-busy={pending}
            className={cn(SECONDARY_BUTTON, "shrink-0 disabled:opacity-60")}
          >
            Kundenansicht beenden
          </Button>
        </div>
        {error && (
          <span className="sr-only" role="alert">
            Kundenansicht nicht beendet. Bitte versuchen Sie es noch einmal.
          </span>
        )}
      </div>
    </div>
  );
}
