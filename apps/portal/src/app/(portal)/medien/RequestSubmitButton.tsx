"use client";

import { useFormStatus } from "react-dom";
import { Wand2 } from "lucide-react";
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
      <Wand2 className="h-4 w-4" />
      {pending ? "Wird gesendet …" : label}
    </Button>
  );
}
