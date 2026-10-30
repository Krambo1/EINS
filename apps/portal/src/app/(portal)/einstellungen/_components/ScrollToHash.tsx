"use client";

import { useEffect } from "react";

/**
 * Scrolls to the card named in the address (`/einstellungen#werbekonten`,
 * linked from Werbebudget). The page streams in behind its skeleton, so the
 * browser's own jump to the fragment often finds no card yet and stays at
 * the top; this runs once the cards are rendered.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
