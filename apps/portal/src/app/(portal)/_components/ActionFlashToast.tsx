"use client";

import * as React from "react";
import {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastClose,
  cn,
} from "@eins/ui";
import {
  TOAST_CARD,
  TOAST_CLOSE,
  TOAST_TEXT,
  TOAST_TITLE,
  ToastIcon,
} from "@/app/_components/toast-look";
import type { FlashPayload } from "@/lib/flash";
import { ACTION_FLASH_EVENT, type ClientFlash } from "./flash-event";

// The shared Toast's tone colours are see-through and set the text in red
// or green on a tint, which was hard to read. Wrapped at the call site: a
// solid white card with dark text, the tone only in the icon (toast-look).

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
          className={TOAST_CARD}
          open={open}
          onOpenChange={setOpen}
          // Errors stay longer: they usually say what to do next. Longer
          // with a button too, so there is time to reach it.
          duration={shown.action || shown.tone === "bad" ? 8000 : 5000}
        >
          <ToastIcon tone={shown.tone} />
          <div className="grid min-w-0 gap-1">
            <ToastTitle className={TOAST_TITLE}>{shown.title}</ToastTitle>
            {shown.description && (
              <ToastDescription className={cn(TOAST_TEXT, "opacity-100")}>{shown.description}</ToastDescription>
            )}
            {shown.action && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  shown.action?.onClick();
                }}
                className="mt-1 justify-self-start rounded-[var(--r-small)] text-sm font-semibold text-fg-primary underline underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary"
              >
                {shown.action.label}
              </button>
            )}
          </div>
          <ToastClose className={TOAST_CLOSE} />
        </Toast>
      )}
      {/* Full width with its own 16 px padding on the phone; the shared
          right-4 pushed it 16 px past the left edge there. */}
      <ToastViewport className="bottom-0 right-0 sm:bottom-4 sm:right-4" />
    </ToastProvider>
  );
}
