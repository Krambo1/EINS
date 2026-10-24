"use client";

import { useEffect, useRef, useState } from "react";
import { PendingDots, authCtaClass } from "../../_components/auth-ui";

/**
 * J-6: the one-time link form, submitted at most once. A second tap would
 * send a second POST that finds the token consumed and could cancel the
 * first navigation (and its session cookie). Still a plain HTML form POST,
 * no auto-submit, so mail scanners burn nothing (B-1).
 */
export function LinkSubmitForm({
  token,
  label,
  action = "/api/auth/callback",
}: {
  token: string;
  label: string;
  /** Route that consumes the token (the admin link page posts to its own). */
  action?: "/api/auth/callback" | "/admin/login/callback";
}) {
  const sentRef = useRef(false);
  const [pending, setPending] = useState(false);

  // Back button restores the page from bfcache with the button still locked.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        sentRef.current = false;
        setPending(false);
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  return (
    <form
      method="post"
      action={action}
      onSubmit={(e) => {
        if (sentRef.current) {
          e.preventDefault();
          return;
        }
        sentRef.current = true;
        setPending(true);
      }}
    >
      <input type="hidden" name="token" value={token} />
      <button type="submit" className={authCtaClass} disabled={pending} aria-busy={pending}>
        {pending ? <PendingDots label="Wird angemeldet" /> : label}
      </button>
    </form>
  );
}
