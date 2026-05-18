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

  function save(newStatus: "mapped" | "ignored" | "unmapped") {
    startTransition(async () => {
      const r = await mapTreatmentAction({
        mappingId,
        portalTreatmentId: newStatus === "mapped" ? picked : null,
        setStatus: newStatus,
      });
      if (r.ok) setLocalStatus(newStatus);
    });
  }

  return (
    <tr className="border-t">
      <td className="p-3">
        <code className="text-xs">{pvsCode}</code>
      </td>
      <td className="p-3">{pvsLabel ?? "—"}</td>
      <td className="p-3">
        <Select
          value={picked ?? "__none__"}
          onValueChange={(v) => setPicked(v === "__none__" ? null : v)}
        >
          <SelectTrigger className="h-8 w-full max-w-xs">
            <SelectValue placeholder="— wählen —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— wählen —</SelectItem>
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
        {localStatus === "mapped" && <Badge tone="good">zugeordnet</Badge>}
        {localStatus === "ignored" && (
          <Badge tone="neutral">ignoriert</Badge>
        )}
        {localStatus === "unmapped" && (
          <Badge tone="warn">offen</Badge>
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
      </td>
    </tr>
  );
}
