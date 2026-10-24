"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { RefreshCw } from "lucide-react";
import { Badge, Button } from "@eins/ui";
import { syncReviewsNowAction, type ReviewSyncState } from "../actions";

const PLATFORM_LABELS: Record<"google" | "jameda", string> = {
  google: "Google",
  jameda: "Jameda",
};

function SyncSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      <RefreshCw className="h-4 w-4" />
      {pending ? "Wird abgeglichen…" : "Jetzt aktualisieren"}
    </Button>
  );
}

/**
 * "Jetzt aktualisieren" for review syncs (B-20 / F-25 / F-30). The result
 * comes back from the action; no flash cookie, no raw platform error text.
 */
export function ReviewSyncButton() {
  const [state, action] = useActionState<ReviewSyncState, FormData>(
    syncReviewsNowAction,
    undefined
  );
  return (
    <div className="space-y-3">
      <form action={action} className="flex justify-end">
        <SyncSubmit />
      </form>
      {state && (
        <div role="status" className="space-y-1 text-sm">
          <p className="text-fg-primary">{state.message}</p>
          {state.platforms.length > 0 && (
            <ul className="space-y-1">
              {state.platforms.map((p) => (
                <li key={p.platform} className="flex items-center gap-2">
                  {p.ok ? (
                    <Badge tone="good">Aktualisiert</Badge>
                  ) : (
                    <Badge tone="warn">Nicht erreichbar</Badge>
                  )}
                  <span className="font-medium text-fg-primary">
                    {PLATFORM_LABELS[p.platform]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
