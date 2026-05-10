"use client";

import { cn } from "@eins/ui";

/**
 * Thin indeterminate progress bar pinned to the top of the viewport.
 *
 * Used by PortalShell to acknowledge two kinds of transitions that otherwise
 * have no visible feedback for ~500–1500ms:
 *
 *   1. Einfach ↔ Detail toggle (server PATCH + router.refresh).
 *   2. Side-nav navigation between portal sections.
 *
 * Pure CSS — a translating shimmer block masked by `overflow-hidden`. We keep
 * the track mounted and toggle opacity so the fade-out reads as "done"
 * instead of vanishing mid-stride.
 */
export function TopProgressBar({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[60] h-[4px] overflow-hidden transition-opacity",
        active ? "opacity-100 duration-100" : "opacity-0 duration-300"
      )}
      style={{
        backgroundColor: active ? "rgba(88, 186, 181, 0.4)" : "transparent",
      }}
    >
      <div
        className="h-full w-1/2"
        style={{
          background: "var(--accent)",
          // Animation runs continuously while mounted. We don't pause it on
          // deactivate, otherwise the shimmer freezes mid-stride during the
          // parent's opacity fade-out and reads as a "cut off" half-bar.
          animation: "opa-topbar 0.9s cubic-bezier(0.45, 0, 0.25, 1) infinite",
        }}
      />
    </div>
  );
}
