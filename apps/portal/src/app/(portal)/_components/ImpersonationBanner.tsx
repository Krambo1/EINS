"use client";

import { useEffect, useState, useTransition } from "react";
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
      className="border-b border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] text-sm text-fg-primary"
    >
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-2 px-4 py-2 md:flex-row md:items-center md:justify-between md:gap-4 md:px-6">
        <div className="flex min-w-0 items-start gap-2">
          <span
            aria-hidden
            className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-tone-warn"
          />
          <p className="min-w-0">
            <span className="font-semibold">Kundenansicht:</span> Sie handeln
            gerade als{" "}
            {/* Own line on phones; the address never breaks mid-word, it is
                cut with an ellipsis instead (full address in the title). */}
            <span className="block md:inline">
              <span
                className="inline-block max-w-full truncate align-bottom font-medium"
                title={targetEmail}
              >
                {targetEmail}
              </span>
              {clinicName ? <> ({clinicName})</> : null}.
            </span>{" "}
            Jede Aktion wird mit Ihrer Admin-Kennung protokolliert.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 pl-4 md:pl-0">
          {remaining ? (
            <span
              className={
                endingSoon
                  ? "font-semibold tabular-nums text-tone-bad"
                  : "font-medium tabular-nums"
              }
            >
              {remaining.charAt(0).toUpperCase() + remaining.slice(1)}
            </span>
          ) : null}
          {error && (
            <span className="text-tone-bad" role="alert">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onEnd}
            disabled={pending}
            className="min-h-11 rounded-lg border border-border bg-bg-primary px-4 py-2 font-medium md:min-h-9 md:px-3 md:py-1 text-fg-primary transition hover:bg-bg-secondary disabled:opacity-60"
          >
            {pending ? "Wird beendet …" : "Kundenansicht beenden"}
          </button>
        </div>
      </div>
    </div>
  );
}
