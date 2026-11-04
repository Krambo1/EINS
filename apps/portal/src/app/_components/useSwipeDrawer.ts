"use client";

import { useEffect } from "react";

/** How far the finger travels sideways before the drawer opens or closes. */
const THRESHOLD = 56;
/** Sideways must clearly win over up and down, or it is a scroll. */
const DOMINANCE = 1.4;
/** The phone's side gutter: no content to tap in it. */
const EDGE_GUARD = 16;

/**
 * Phone only (below md): a swipe to the right anywhere on the page opens the
 * nav drawer, a swipe to the left closes it. Before, only a swipe from the
 * very left edge did, and that edge belongs to the browser's own "back"
 * gesture, so the swipe went back a page instead.
 *
 * A swipe that starts on something that already uses sideways movement is
 * left alone: a chart that follows the finger (`touch-none`), a region that
 * scrolls sideways, a text field, a slider, or anything marked
 * `data-no-swipe`.
 *
 * Android's system back gesture cannot be switched off from a web page, and
 * Safari on iOS only lets go of its edge swipe in some versions (the edge
 * guard below); `overscroll-behavior-x: none` in globals.css stops the swipe
 * back Chrome adds when a page is pulled sideways.
 */
export function useSwipeDrawer(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (!mq.matches || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!t) return;
      // Inside the 16 px side gutter there is no content to tap. Claiming the
      // touch there keeps Safari on iOS from starting its own swipe back
      // where the browser allows a page to do so.
      if (!open && t.clientX < EDGE_GUARD && e.cancelable) e.preventDefault();
      if (!open && usesSidewaysTouch(e.target)) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      // A clear scroll ends the gesture: the page is moving, not the drawer.
      if (dy > THRESHOLD / 2 && dy * DOMINANCE > Math.abs(dx)) {
        tracking = false;
        return;
      }
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < dy * DOMINANCE) return;
      tracking = false;
      if (!open && dx > 0) setOpen(true);
      else if (open && dx < 0) setOpen(false);
    };
    const onEnd = () => {
      tracking = false;
    };

    // Not passive: the edge guard above calls preventDefault.
    window.addEventListener("touchstart", onStart, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [open, setOpen]);
}

/** True when the touch starts on something that moves sideways by itself. */
function usesSidewaysTouch(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  if (el?.closest("input, textarea, select, [contenteditable], [role='slider'], [data-no-swipe]")) {
    return true;
  }
  for (; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.touchAction === "none" || style.touchAction.includes("pan-y")) return true;
    if (
      (style.overflowX === "auto" || style.overflowX === "scroll") &&
      el.scrollWidth > el.clientWidth + 1
    ) {
      return true;
    }
  }
  return false;
}
