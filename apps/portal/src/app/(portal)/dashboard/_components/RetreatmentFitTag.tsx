"use client";

import { useLayoutEffect, useRef, useState } from "react";

const FULL = "Wiederbehandlung";
const SHORT = "Wiederbeh.";

/**
 * The Wiederbehandlung tag in an "Offene Anfragen" row, after the Behandlung:
 * the amber dot and the full word while the line has room for both, "Wiederbeh."
 * only when it does not (Karam, 2026-10-30). CSS cannot tell whether text
 * fits, so the line is measured: the Behandlung's own width plus the full tag
 * against the line's width, again whenever the line resizes. The full
 * sentence is the hover text and what screen readers read.
 */
export function RetreatmentFitTag({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fullRef = useRef<HTMLSpanElement>(null);
  const [short, setShort] = useState(false);

  useLayoutEffect(() => {
    const tag = ref.current;
    const full = fullRef.current;
    const line = tag?.parentElement;
    if (!tag || !full || !line) return;
    const fit = () => {
      const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
      let needed = full.offsetWidth;
      for (const el of Array.from(line.children)) {
        // scrollWidth: a truncated Behandlung counts at its whole width.
        if (el !== tag) needed += el.scrollWidth + gap;
      }
      setShort(needed > line.clientWidth);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(line);
    document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      title={text}
      className="relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-tone-warn" />
      <span aria-hidden>{short ? SHORT : FULL}</span>
      <span className="sr-only">{text}</span>
      {/* The full tag, invisible and out of the flow, to measure against. */}
      <span
        ref={fullRef}
        aria-hidden
        className="invisible absolute left-0 top-0 inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" />
        {FULL}
      </span>
    </span>
  );
}
