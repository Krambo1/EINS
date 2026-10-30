"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@eins/ui";

/**
 * Wraps one text field that scrolls (a `scroll-shadows` well or a textarea)
 * and puts an arrow in a circle in its bottom right corner while there is
 * more text below (Karam, 2026-10-30: the edge shadow alone was too easy to
 * miss). It fades out at the bottom and never shows when everything fits.
 * A click scrolls on by most of a field. The field itself stays the
 * keyboard and screen reader target, so the arrow is hidden from both.
 *
 * The field is the wrapper's only child; give the wrapper the layout the
 * field had in its parent (`flex min-h-0 flex-1 flex-col` for a field that
 * fills a column). The arrow takes the place of the scroll bar and the
 * resize grip, so the wrapper hides both.
 *
 * `watch` is for a textarea whose value React sets without typing
 * ("Vorlage einfügen"): pass the value so the arrow checks again.
 */
export function ScrollHint({
  children,
  className,
  watch,
}: {
  children: ReactNode;
  className?: string;
  watch?: unknown;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const field = wrapRef.current?.firstElementChild;
    if (!(field instanceof HTMLElement)) return;
    const check = () => setMore(field.scrollHeight - field.clientHeight - field.scrollTop > 2);
    check();
    field.addEventListener("scroll", check, { passive: true });
    field.addEventListener("input", check);
    // The field's own size (the column width on resize) and its content's
    // (a well whose text changes) both change what is left to scroll.
    const ro = new ResizeObserver(check);
    ro.observe(field);
    for (const child of Array.from(field.children)) ro.observe(child);
    const mo = new MutationObserver(check);
    mo.observe(field, { childList: true, subtree: true, characterData: true });
    return () => {
      field.removeEventListener("scroll", check);
      field.removeEventListener("input", check);
      ro.disconnect();
      mo.disconnect();
    };
  }, [watch]);

  function scrollOn() {
    const field = wrapRef.current?.firstElementChild;
    if (!(field instanceof HTMLElement)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    field.scrollBy({ top: field.clientHeight * 0.8, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative [&>*::-webkit-scrollbar]:hidden [&>*]:[scrollbar-width:none] [&>textarea]:resize-none",
        className
      )}
    >
      {children}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={scrollOn}
        className={cn(
          "elev-raised absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-raised)] text-fg-primary transition-opacity duration-300",
          more ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <ArrowDown className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
