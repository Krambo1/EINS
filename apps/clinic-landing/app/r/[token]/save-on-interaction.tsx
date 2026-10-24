"use client";

import { useEffect } from "react";
import { recordRating } from "./actions";

const EVENTS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * Books the star the patient tapped in the email, but only after a real
 * interaction with the page. Link scanners load every star link of the mail
 * without touching the page, so loading alone books nothing (E-31).
 *
 * Interactions on a form, button or link are left alone: the star picker,
 * the public review button and the private form each book the rating
 * themselves, and a second write here could race them.
 */
export function SaveOnInteraction({ token, rating }: { token: string; rating: number }) {
  useEffect(() => {
    let done = false;
    const onEvent = (e: Event) => {
      if (done) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("form, button, a")) return;
      done = true;
      EVENTS.forEach((name) => window.removeEventListener(name, onEvent));
      void recordRating(token, rating);
    };
    EVENTS.forEach((name) => window.addEventListener(name, onEvent, { passive: true }));
    return () => EVENTS.forEach((name) => window.removeEventListener(name, onEvent));
  }, [token, rating]);
  return null;
}
