"use client";

import { useState } from "react";

/**
 * EINS Bewertungen: message to the practice, never published.
 *
 * Shown open on the 1-to-3-star page (text required) and as an optional note
 * when a 4/5 rating has no public profile to open. Message, optional
 * call-back with name and email. Posts to /r/[token]/feedback (a
 * clinic-landing proxy to the portal) and thanks inline, so the patient stays
 * on the page. Asks for stars only when none were given yet.
 */
export function FeedbackForm({
  token,
  rating,
  requireText,
}: {
  token: string;
  rating: number | null;
  requireText: boolean;
}) {
  // Own pick only when the page has no stars yet; otherwise the page's
  // rating wins, also after the patient changed it above (props update,
  // state would not).
  const [pick, setPick] = useState<number>(0);
  const stars = rating ?? pick;
  const [contactBackOk, setContactBackOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field =
    "mt-1.5 block w-full rounded-[12px] border border-brand-border bg-brand-bg px-3.5 py-3 text-[15px] text-brand-fg placeholder:text-brand-fg-muted focus:border-brand-fg focus:outline-none";

  if (done) {
    return (
      <p role="status" className="rounded-[12px] bg-brand-bg-soft p-4 text-center text-[14px] text-brand-fg">
        Danke. Ihre Nachricht ist bei der Praxisleitung angekommen.
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const freeText = String(data.get("freeText") ?? "").trim();
    const contactName = String(data.get("contactName") ?? "").trim();
    const contactEmail = String(data.get("contactEmail") ?? "").trim();
    if (stars < 1) {
      setError("Bitte wählen Sie zuerst Ihre Sterne.");
      return;
    }
    if (requireText && !freeText) {
      setError("Bitte schreiben Sie kurz, was wir besser machen können.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/r/${encodeURIComponent(token)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: stars,
          freeText: freeText || undefined,
          contactBackOk,
          contactName: contactBackOk && contactName ? contactName : undefined,
          contactEmail: contactBackOk && contactEmail ? contactEmail : undefined,
        }),
      });
      if (!res.ok) throw new Error("send failed");
      setDone(true);
    } catch {
      setError("Senden hat nicht geklappt. Bitte versuchen Sie es gleich noch einmal.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {rating === null && (
        <fieldset>
          <legend className="text-[14px] font-medium text-brand-fg">Ihre Sterne</legend>
          <div className="mt-1.5 flex gap-1" role="radiogroup" aria-label="Sterne">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === pick}
                aria-label={`${n} von 5 Sternen`}
                onClick={() => setPick(n)}
                className="text-[30px] leading-none transition hover:scale-110"
                style={{ color: n <= pick ? "#F5B400" : "#E4E4E7" }}
              >
                ★
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <label htmlFor="freeText" className="block text-[14px] font-medium text-brand-fg">
          Ihre Nachricht an die Praxis
        </label>
        <textarea
          id="freeText"
          name="freeText"
          rows={5}
          maxLength={5000}
          required={requireText}
          placeholder={
            requireText
              ? "Was ist nicht gut gelaufen? Je genauer, desto besser kann die Praxis reagieren."
              : "Ihre Nachricht"
          }
          className={field}
        />
      </div>

      <label className="flex items-start gap-3 text-[14px] text-brand-fg">
        <input
          type="checkbox"
          checked={contactBackOk}
          onChange={(e) => setContactBackOk(e.target.checked)}
          className="mt-0.5 h-5 w-5 rounded border-brand-border accent-[#10101a]"
        />
        <span>Die Praxis darf sich bei mir melden.</span>
      </label>

      {contactBackOk && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="contactName" className="block text-[13px] font-medium text-brand-fg">
              Name (optional)
            </label>
            <input id="contactName" name="contactName" type="text" maxLength={200} autoComplete="name" className={field} />
          </div>
          <div>
            <label htmlFor="contactEmail" className="block text-[13px] font-medium text-brand-fg">
              E-Mail (optional)
            </label>
            <input id="contactEmail" name="contactEmail" type="email" maxLength={200} autoComplete="email" className={field} />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13.5px] text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-[14px] bg-brand-fg px-5 py-4 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? "Wird gesendet …" : "An die Praxis senden"}
      </button>
    </form>
  );
}
