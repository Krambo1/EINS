"use client";

import { Card, CardContent, Button } from "@eins/ui";
import { AlertTriangle } from "lucide-react";

export default function AnfragenError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertTriangle className="h-8 w-8 text-tone-bad" aria-hidden />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-fg-primary">
            Die Anfragen konnten nicht geladen werden.
          </h2>
          <p className="text-sm text-fg-secondary">
            Bitte versuchen Sie es erneut. Bleibt das Problem bestehen, laden
            Sie die Seite neu.
          </p>
        </div>
        <Button variant="outline" size="md" onClick={() => reset()}>
          Erneut versuchen
        </Button>
      </CardContent>
    </Card>
  );
}
