"use client";

import { PendingSubmitButton } from "./PendingSubmitButton";
import type { ButtonProps } from "@eins/ui";

/**
 * DS5: submit button for destructive or hard-to-undo admin actions (Löschen,
 * Entfernen, Aufheben, Pause, Ende). Always red (`variant="danger"`), always
 * asks first, and shows a pending label while the server action runs. The
 * page's existing success/error hints report the outcome afterwards.
 */
export function DangerSubmitButton({
  confirm,
  pendingLabel = "Wird ausgeführt …",
  ...props
}: Omit<ButtonProps, "type" | "variant"> & {
  /** Question in the confirm dialog; required, nothing destructive goes out unasked. */
  confirm: string;
  pendingLabel?: React.ReactNode;
}) {
  return <PendingSubmitButton {...props} variant="danger" confirm={confirm} pendingLabel={pendingLabel} />;
}
