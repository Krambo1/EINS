"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@eins/ui";

/**
 * Submit button for admin server-action forms: disabled while the action runs
 * (no double submit) and, with `confirm`, asks before submitting. Visual style
 * is the plain `Button`, the caller keeps choosing variant and size.
 */
export function PendingSubmitButton({
  confirm,
  pendingLabel,
  children,
  onClick,
  disabled,
  ...props
}: Omit<ButtonProps, "type"> & {
  /** Question shown in a browser confirm dialog before the form submits. */
  confirm?: string;
  /** Label while the action runs; defaults to the normal label. */
  pendingLabel?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  // With `confirm`, stay disabled until hydrated: before that the onClick
  // below does not exist and a click would submit the form unasked (VD2:
  // two journey steps deleted on a page that had not hydrated yet).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <Button
      {...props}
      type="submit"
      disabled={pending || disabled || (Boolean(confirm) && !hydrated)}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
