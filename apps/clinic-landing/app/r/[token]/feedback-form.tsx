"use client";

import { useEffect, useRef, useState } from "react";

/**
 * EINS Stimme — private feedback client form.
 *
 * Posts to /r/[token]/feedback (a clinic-landing API proxy that forwards
 * to the portal). On success, shows an inline thank-you instead of
 * navigating away — keeps the patient on the same branded surface.
 *
 * `collapsed=true` renders a small expand-button instead of the full form,
 * used when the public CTA is primary (high rating) but we still want to
 * keep the private path reachable for the BGH/Google compliance rule.
 */

export function FeedbackForm({
  token,
  defaultRating,
  collapsed,
}: {
  token: string;
  defaultRating: number;
  collapsed: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsed);
  const [rating, setRating] = useState<number>(defaultRating);
  const [contactBackOk, setContactBackOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // When the form expands from collapsed, focus the textarea so keyboard
  // users land in the right place. We skip on first mount for the always-
  // expanded variant — no need to steal focus from the page heading.
  useEffect(() => {
    if (expanded && collapsed) {
      textareaRef.current?.focus();
    }
  }, [expanded, collapsed]);

  if (done) {
    return (
      <p
        role="status"
        className="rounded-brand bg-brand-bg-soft p-4 text-sm text-brand-fg"
      >
        Danke für Ihre Rückmeldung. Die Praxisleitung erhält Ihre Nachricht und meldet sich, falls Sie das wünschen.
      </p>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-sm font-medium text-brand-fg underline underline-offset-4 hover:text-brand-primary"
      >
        Private Rückmeldung schreiben →
      </button>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setSubmitting(true);

    const data = new FormData(form);
    const freeText = String(data.get("freeText") ?? "").trim();
    const contactName = String(data.get("contactName") ?? "").trim();
    const contactEmail = String(data.get("contactEmail") ?? "").trim();

    try {
      const res = await fetch(`/r/${encodeURIComponent(token)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          freeText: freeText || undefined,
          contactBackOk,
          contactName: contactName || undefined,
          contactEmail: contactEmail || undefined,
        }),
      });
      if (!res.ok) {
        setError("Senden hat nicht geklappt. Bitte versuchen Sie es gleich noch einmal.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Senden hat nicht geklappt. Bitte versuchen Sie es gleich noch einmal.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-brand-fg">
          Ihre Bewertung
        </legend>
        <div className="mt-2 inline-flex gap-1" role="radiogroup" aria-label="Bewertung">
          {[1, 2, 3, 4, 5].map((n) => {
            const active = n <= rating;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === rating}
                onClick={() => setRating(n)}
                className={`flex h-10 w-10 items-center justify-center rounded-brand text-lg transition ${
                  active
                    ? "bg-brand-primary text-white"
                    : "bg-brand-bg-soft text-brand-fg-muted hover:bg-brand-border/40"
                }`}
                aria-label={`${n} Sterne`}
              >
                ★
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="freeText" className="block text-sm font-medium text-brand-fg">
          Was sollten wir wissen?
        </label>
        <textarea
          ref={textareaRef}
          id="freeText"
          name="freeText"
          rows={5}
          maxLength={5000}
          placeholder="Was war gut, was nicht. Je konkreter, desto besser können wir reagieren."
          className="mt-2 block w-full rounded-brand border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-fg placeholder:text-brand-fg-muted focus:border-brand-primary focus:outline-none"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="contactName" className="block text-sm font-medium text-brand-fg">
            Name (optional)
          </label>
          <input
            id="contactName"
            name="contactName"
            type="text"
            maxLength={200}
            autoComplete="name"
            className="mt-2 block w-full rounded-brand border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-fg focus:border-brand-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="contactEmail" className="block text-sm font-medium text-brand-fg">
            E-Mail für Rückruf (optional)
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            maxLength={200}
            autoComplete="email"
            className="mt-2 block w-full rounded-brand border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-fg focus:border-brand-primary focus:outline-none"
          />
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm text-brand-fg">
        <input
          type="checkbox"
          checked={contactBackOk}
          onChange={(e) => setContactBackOk(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-brand-border text-brand-primary focus:ring-brand-primary"
        />
        <span>
          Die Praxis darf sich bei mir melden, um auf diese Rückmeldung
          einzugehen.
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-brand bg-brand-primary px-5 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Wird gesendet…" : "Vertraulich senden"}
        </button>
        <span className="text-xs text-brand-fg-muted">
          Geht ausschließlich an die Praxisleitung. Wird nicht veröffentlicht.
        </span>
      </div>
    </form>
  );
}
