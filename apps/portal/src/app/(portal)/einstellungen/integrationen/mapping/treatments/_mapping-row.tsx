"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Badge,
} from "@eins/ui";
import { mapTreatmentAction } from "../../actions";

export function MappingRow({
  mappingId,
  pvsCode,
  pvsLabel,
  currentPortalId,
  suggestedId,
  status,
  treatments,
}: {
  mappingId: string;
  pvsCode: string;
  pvsLabel: string | null;
  currentPortalId: string | null;
  suggestedId: string | null;
  status: "unmapped" | "mapped" | "ignored";
  treatments: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string | null>(currentPortalId ?? null);
  const [localStatus, setLocalStatus] = useState(status);
  const [error, setError] = useState<string | null>(null);

  function save(newStatus: "mapped" | "ignored" | "unmapped") {
    setError(null);
    startTransition(async () => {
      try {
        const r = await mapTreatmentAction({
          mappingId,
          portalTreatmentId: newStatus === "mapped" ? picked : null,
          setStatus: newStatus,
        });
        if (r.ok) setLocalStatus(newStatus);
        else setError(r.error ?? "Speichern hat nicht geklappt. Bitte versuchen Sie es noch einmal.");
      } catch {
        setError("Keine Verbindung. Bitte versuchen Sie es noch einmal.");
      }
    });
  }

  return (
    <tr className="border-t">
      <td className="hidden p-3 sm:table-cell">
        <code className="text-sm">{pvsCode}</code>
      </td>
      <td className="p-3">
        {pvsLabel ?? "–"}
        <div className="mt-0.5 sm:hidden">
          <span className="text-sm text-fg-primary">Kürzel aus Ihrer Praxissoftware: </span>
          <code className="text-sm text-fg-primary">{pvsCode}</code>
        </div>
      </td>
      <td className="p-3">
        <Select
          value={picked ?? "__none__"}
          onValueChange={(v) => setPicked(v === "__none__" ? null : v)}
        >
          <SelectTrigger className="h-8 w-full max-w-xs">
            <SelectValue placeholder="Bitte wählen">
              {treatments.find((t) => t.id === picked)?.name ?? "Bitte wählen"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Bitte wählen</SelectItem>
            {treatments.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
                {t.id === suggestedId && " ★ Vorschlag"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="space-x-1 p-3">
        {localStatus === "mapped" && <Badge tone="good">Zugeordnet</Badge>}
        {localStatus === "ignored" && (
          <Badge tone="neutral">Ignoriert</Badge>
        )}
        {localStatus === "unmapped" && (
          <Badge tone="warn">Offen</Badge>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !picked}
            onClick={() => save("mapped")}
          >
            Speichern
          </Button>
          {localStatus !== "ignored" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => save("ignored")}
            >
              Ignorieren
            </Button>
          )}
        </div>
        {error && <p className="mt-1 text-sm text-tone-bad">{error}</p>}
      </td>
    </tr>
  );
}
