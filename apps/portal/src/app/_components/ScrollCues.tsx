"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@eins/ui";
import {
  SCROLL_ARROW,
  SCROLL_ARROW_ICON,
  SCROLL_ARROW_INSET,
  SCROLL_ARROW_PX,
  SCROLL_ARROW_SIZE,
  SMALL_REGION,
  hasMoreBelow,
  scrollOn,
} from "./ScrollHint";

/**
 * The arrow for every scroll region on every page (Karam, 2026-10-30: the
 * edge shadow alone was not obvious enough, lists of rows included). Mounted
 * once in the root layout, it finds each `.scroll-shadows` region, and while
 * one has more below it puts `ScrollHint`'s arrow in its bottom right corner.
 * A page only writes the class; there is nothing to wrap or to forget.
 *
 * The arrows live in one layer at the top of the document, placed in page
 * coordinates, so the page scrolling carries them along without a frame of
 * lag. They sit under the sticky bands (z-30), the phone header (z-40) and
 * every popover and dialog (z-50).
 *
 * A region that already sits in `ScrollHint` (a textarea, a text well) keeps
 * that arrow. A region inside a dialog or a popover must use `ScrollHint`:
 * this layer sits under them, so it skips those and warns in development.
 */

type Cue = { el: HTMLElement; left: number; top: number; small: boolean; more: boolean };

const REGION = ".scroll-shadows";
const OVERLAY = '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]';

const warned = new WeakSet<Element>();

function measure(): Cue[] {
  const cues: Cue[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(REGION))) {
    if (el.parentElement?.hasAttribute("data-scroll-hint")) continue;
    if (el.scrollHeight - el.clientHeight <= 2) continue;
    if (el.closest(OVERLAY)) {
      if (process.env.NODE_ENV !== "production" && !warned.has(el)) {
        warned.add(el);
        console.warn("ScrollCues: a scroll region inside a dialog or popover needs ScrollHint", el);
      }
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const small = r.height < SMALL_REGION;
    const size = small ? SCROLL_ARROW_PX.small : SCROLL_ARROW_PX.normal;
    const inset = small ? SCROLL_ARROW_INSET.small : SCROLL_ARROW_INSET.normal;
    cues.push({
      el,
      left: Math.round(r.right + window.scrollX - inset - size),
      top: Math.round(r.bottom + window.scrollY - inset - size),
      small,
      more: hasMoreBelow(el),
    });
  }
  return cues;
}

function same(a: Cue[], b: Cue[]) {
  return (
    a.length === b.length &&
    a.every((c, i) => {
      const d = b[i];
      return c.el === d.el && c.left === d.left && c.top === d.top && c.small === d.small && c.more === d.more;
    })
  );
}

export function ScrollCues() {
  const [cues, setCues] = useState<Cue[]>([]);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measure();
      setCues((prev) => (same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    // Anything that can move a region, change its size or what it holds: a
    // region scrolling, the window, the page growing, new rows, a card's rise
    // animation ending, the web font arriving. The layer's own changes don't
    // count, or every update would schedule the next.
    const mo = new MutationObserver((records) => {
      if (records.every((r) => layerRef.current?.contains(r.target))) return;
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionend", schedule, true);
    document.addEventListener("animationend", schedule, true);
    void document.fonts?.ready.then(schedule);
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      mo.disconnect();
      ro.disconnect();
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionend", schedule, true);
      document.removeEventListener("animationend", schedule, true);
    };
  }, []);

  // A region's size and its rows' sizes change without the page height
  // changing (a column narrowing, a row wrapping), which the body observer
  // above does not see.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const next = measure();
      setCues((prev) => (same(prev, next) ? prev : next));
    });
    for (const c of cues) {
      ro.observe(c.el);
      for (const child of Array.from(c.el.children)) ro.observe(child);
    }
    return () => ro.disconnect();
  }, [cues]);

  return (
    <div ref={layerRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0 overflow-x-clip">
      {cues.map((c, i) => {
        const size = c.small ? "small" : "normal";
        return (
          <button
            // Regions keep their order in the page, so the index stays with
            // one region while it scrolls and the fade-out can run.
            key={i}
            type="button"
            tabIndex={-1}
            onClick={() => scrollOn(c.el)}
            style={{ left: c.left, top: c.top }}
            className={cn(
              SCROLL_ARROW,
              SCROLL_ARROW_SIZE[size],
              "absolute",
              c.more ? "pointer-events-auto opacity-100" : "opacity-0"
            )}
          >
            <ArrowDown className={SCROLL_ARROW_ICON[size]} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
