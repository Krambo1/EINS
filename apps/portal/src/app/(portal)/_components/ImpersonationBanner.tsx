"use client";

import { useState, useTransition } from "react";

interface Props {
  targetEmail: string;
  clinicName: string;
}

/**
 * Yellow top banner shown on every clinic-portal page when the active
 * session was opened by an admin via "View as user". The "Beenden"
 * button POSTs to /api/auth/end-impersonation, which revokes the session
 * server-side and returns the admin host URL to land back on. We try
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
      className="border-b border-yellow-500/40 bg-yellow-300 text-yellow-950"
    >
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm md:px-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base leading-none">⚠</span>
          <span>
            <strong className="font-semibold">Impersonation aktiv</strong> — Sie
            sehen das Portal als{" "}
            <span className="font-mono">{targetEmail}</span>
            {clinicName ? (
              <>
                {" "}
                (<span className="font-medium">{clinicName}</span>)
              </>
            ) : null}
            .
          </span>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-red-700" role="alert">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onEnd}
            disabled={pending}
            className="rounded-md border border-yellow-700/40 bg-yellow-200/80 px-3 py-1 font-medium hover:bg-yellow-100 disabled:opacity-60"
          >
            {pending ? "Beenden …" : "Beenden"}
          </button>
        </div>
      </div>
    </div>
  );
}
