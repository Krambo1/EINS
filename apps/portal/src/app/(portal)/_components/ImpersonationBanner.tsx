"use client";

import { useState, useTransition } from "react";

interface Props {
  targetEmail: string;
  clinicName: string;
}

/**
 * Subtle top bar shown on every clinic-portal page when the active
 * session was opened by an admin via "View as user". Designed to stay
 * out of the way — a thin neutral strip with a small warn dot, just
 * enough to remind the admin they are not the user. The "Beenden"
 * button POSTs to /api/auth/end-impersonation, which revokes the
 * session server-side and returns the admin host URL. We try
 * window.close() first (the tab was opened by JS, so the browser
 * permits it), then fall back to navigation.
 */
export function ImpersonationBanner({ targetEmail, clinicName }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onEnd = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/end-impersonation", {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        const data = (await res.json()) as { ok: boolean; redirectTo?: string };
        if (!data.ok || !data.redirectTo) {
          throw new Error("Konnte Impersonation nicht beenden.");
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
      className="border-b border-border bg-bg-secondary text-xs text-fg-secondary"
    >
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-4 py-1.5 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-tone-warn"
          />
          <span className="truncate">
            Impersonation:{" "}
            <span className="font-mono text-fg-primary/80">{targetEmail}</span>
            {clinicName ? (
              <span className="text-fg-secondary"> · {clinicName}</span>
            ) : null}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {error && (
            <span className="text-tone-bad" role="alert">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onEnd}
            disabled={pending}
            className="text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline disabled:opacity-60"
          >
            {pending ? "…" : "Beenden"}
          </button>
        </div>
      </div>
    </div>
  );
}
