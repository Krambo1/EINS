"use client";

import { useEffect, useState, type ComponentProps, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@eins/ui";

/**
 * Submit button that asks before a destructive form action runs (F-21):
 * remove a team member, archive a treatment or location, disconnect an ad
 * account. Plain `window.confirm`, like the n8n secret reveal. Disabled while
 * the action runs (double-click protection).
 */
export function ConfirmSubmitButton({
  confirmText,
  children,
  disabled,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { confirmText: string }) {
  const { pending } = useFormStatus();
  // Disabled until hydrated: before that the confirm in onClick does not
  // exist and a click would submit unasked (VD2).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <Button
      {...props}
      type="submit"
      disabled={disabled || pending || !hydrated}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (!window.confirm(confirmText)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </Button>
  );
}
