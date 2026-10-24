"use client";

import { useEffect, useRef } from "react";

/**
 * Opens the public review at once for 4 and 5 stars by submitting the
 * one-button form to /r/<token>/go, which books the stars and the click and
 * redirects (303) to Google or Jameda.
 *
 * Script-only on purpose: a link scanner that merely loads the star link
 * books nothing (E-31). Opens once per browser tab: coming back from Google
 * with the back button shows the button instead of bouncing the patient
 * straight back. Without script the button is the way.
 */
export function AutoOpenPublic({
  href,
  rating,
  label,
  onceKey,
}: {
  href: string;
  rating: number;
  label: string;
  onceKey: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alreadyOpened = false;
    try {
      alreadyOpened = sessionStorage.getItem(onceKey) === "1";
      sessionStorage.setItem(onceKey, "1");
    } catch {
      // storage blocked: open anyway
    }
    if (!alreadyOpened) formRef.current?.requestSubmit();
  }, [onceKey]);

  return (
    <form ref={formRef} method="post" action={href} className="mt-7">
      <input type="hidden" name="rating" value={rating} />
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-3 rounded-[14px] bg-brand-fg px-5 py-4 text-[16px] font-semibold text-white transition hover:opacity-90 active:scale-[0.99]"
      >
        {label}
      </button>
    </form>
  );
}
