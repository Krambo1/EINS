import { ALL_REQUEST_STATUS_LABELS, type AnyRequestStatus } from "@/lib/constants";

function label(v: unknown): string | null {
  return typeof v === "string" && v in ALL_REQUEST_STATUS_LABELS
    ? ALL_REQUEST_STATUS_LABELS[v as AnyRequestStatus]
    : null;
}

/**
 * V7 3.6: the Verlauf line for a status_change activity, e.g.
 * "Status: Kontaktiert → Termin vereinbart". Every writer (cockpit, call log,
 * PVS derive) stores `meta.from` / `meta.to`; PVS rows may carry
 * `derivedStatus` instead of `to`. Null when there is no real change to show
 * (unknown values, or a PVS revenue update with from === to).
 */
export function statusChangeLine(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const to = label(m.to) ?? label(m.derivedStatus);
  if (!to) return null;
  const from = label(m.from);
  if (from === to) return null;
  return from ? `Status: ${from} → ${to}` : `Status: ${to}`;
}
