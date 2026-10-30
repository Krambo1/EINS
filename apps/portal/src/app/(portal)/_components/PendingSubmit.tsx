"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@eins/ui";

/**
 * The submit button of a one-tap form: greyed out while the action runs, so
 * a second tap does nothing. Same size either way; the toast says what was
 * saved.
 */
export function PendingSubmit(props: Omit<ComponentProps<typeof Button>, "type">) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending} />;
}
