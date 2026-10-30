"use client";

import * as React from "react";
import {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastClose,
} from "@eins/ui";
import type { FlashPayload } from "@/lib/flash";
import { ACTION_FLASH_EVENT, type ClientFlash } from "./flash-event";

// The shared Toast's tone colours are see-through, so the page showed
// through it. Here the page colour lies under the tint (a background-image
// paints over the background-color), wrapped at the call site.
const SOLID_TONE: Record<FlashPayload["tone"], string> = {
  good: "bg-bg-primary [background-image:linear-gradient(var(--tone-good-bg),var(--tone-good-bg))]",
  bad: "bg-bg-primary [background-image:linear-gradient(var(--tone-bad-bg),var(--tone-bad-bg))]",
};

/**
 * Bottom-right toast that confirms every server action that ran on the
 * previous request. The (portal) layout reads the flash cookie via
 * `readActionFlash()` and passes the payload here on each render.
 *
 * We keep the last-shown payload in local state so the toast remains
 * visible after the cookie is consumed and after subsequent navigations
 * within the layout don't clobber it.
 */
export function ActionFlashToast({ flash }: { flash: FlashPayload | null }) {
  const [shown, setShown] = React.useState<(FlashPayload & Pick<ClientFlash, "action">) | null>(flash);
  const [open, setOpen] = React.useState<boolean>(Boolean(flash));

  React.useEffect(() => {
    if (flash && flash.id !== shown?.id) {
      setShown(flash);
      setOpen(true);
    }
  }, [flash, shown?.id]);

  // The same toast for client components whose action returns a result
  // (showActionFlash in flash-event.ts).
  React.useEffect(() => {
    let n = 0;
    const onFlash = (e: Event) => {
      const detail = (e as CustomEvent<ClientFlash>).detail;
      if (!detail) return;
      n += 1;
      setShown({ ...detail, id: `client-${Date.now()}-${n}` });
      setOpen(true);
    };
    window.addEventListener(ACTION_FLASH_EVENT, onFlash);
    return () => window.removeEventListener(ACTION_FLASH_EVENT, onFlash);
  }, []);

  return (
    <ToastProvider swipeDirection="right">
      {shown && (
        <Toast
          key={shown.id}
          tone={shown.tone}
          className={SOLID_TONE[shown.tone]}
          open={open}
          onOpenChange={setOpen}
          // Longer with a button, so there is time to reach it.
          duration={shown.action ? 8000 : 5000}
        >
          <div className="grid gap-1">
            <ToastTitle>{shown.title}</ToastTitle>
            {shown.description && (
              <ToastDescription>{shown.description}</ToastDescription>
            )}
            {shown.action && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  shown.action?.onClick();
                }}
                className="mt-1 justify-self-start rounded-[var(--r-small)] text-sm font-semibold underline underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {shown.action.label}
              </button>
            )}
          </div>
          <ToastClose />
        </Toast>
      )}
      {/* Full width with its own 16 px padding on the phone; the shared
          right-4 pushed it 16 px past the left edge there. */}
      <ToastViewport className="bottom-0 right-0 sm:bottom-4 sm:right-4" />
    </ToastProvider>
  );
}
