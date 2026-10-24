"use client";

import { startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@eins/ui";
import { AlertTriangle } from "lucide-react";

/**
 * Error boundary for every admin page (inside the admin shell). Errors thrown
 * by admin/layout.tsx itself fall through to app/error.tsx.
 * Shows no raw error text: server errors arrive here with a generic message
 * plus `digest`, which is the id in the server log (see instrumentation.ts).
 *
 * "Erneut versuchen" refreshes the server render before resetting the
 * boundary; `reset()` alone would only re-render the client tree and hit the
 * same cached server error again.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertTriangle className="h-8 w-8 text-tone-bad" aria-hidden />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-fg-primary">
            Diese Seite konnte gerade nicht geladen werden.
          </h2>
          <p className="text-sm text-fg-secondary">
            Bitte versuchen Sie es erneut. Bleibt das Problem bestehen, prüfen
            Sie die Server-Logs mit der Fehlernummer.
          </p>
          {error.digest && (
            <p className="text-sm text-fg-secondary">
              Fehlernummer: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            size="md"
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            Erneut versuchen
          </Button>
          <Button asChild variant="ghost" size="md">
            <Link href="/">Zur Übersicht</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
