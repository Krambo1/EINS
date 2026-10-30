"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@eins/ui";

/** Submit button of the approval forms: disabled while the decision is saved (no double submit). */
export function DecisionSubmitButton({ children, ...props }: Omit<ButtonProps, "type">) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending || undefined}>
      {pending ? "Wird gespeichert …" : children}
    </Button>
  );
}
