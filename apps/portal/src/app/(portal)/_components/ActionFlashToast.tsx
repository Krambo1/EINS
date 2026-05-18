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
  const [shown, setShown] = React.useState<FlashPayload | null>(flash);
  const [open, setOpen] = React.useState<boolean>(Boolean(flash));

  React.useEffect(() => {
    if (flash && flash.id !== shown?.id) {
      setShown(flash);
      setOpen(true);
    }
  }, [flash, shown?.id]);

  return (
    <ToastProvider swipeDirection="right">
      {shown && (
        <Toast
          key={shown.id}
          tone={shown.tone}
          open={open}
          onOpenChange={setOpen}
          duration={5000}
        >
          <div className="grid gap-1">
            <ToastTitle>{shown.title}</ToastTitle>
            {shown.description && (
              <ToastDescription>{shown.description}</ToastDescription>
            )}
          </div>
          <ToastClose />
        </Toast>
      )}
      <ToastViewport />
    </ToastProvider>
  );
}
