"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@eins/ui";

/** Submit button for "Anpassung anfordern": disabled while the request runs. */
export function RequestSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      className="w-full"
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending ? "Wird gesendet …" : label}
    </Button>
  );
}
