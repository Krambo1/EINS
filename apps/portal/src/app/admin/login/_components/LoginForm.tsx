"use client";

import { Input, Label, Button } from "@eins/ui";
import { requestAdminMagicLinkAction } from "../actions";

export function LoginForm() {
  return (
    <form action={requestAdminMagicLinkAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">E-Mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>
      <Button type="submit" className="w-full">
        Anmeldelink senden
      </Button>
      <p className="text-xs text-fg-secondary">
        Nur in der Allowlist hinterlegte Admin-Adressen erhalten einen Link.
      </p>
    </form>
  );
}
