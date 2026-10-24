import { Badge } from "@eins/ui";
import type { EnforcementState } from "@/lib/response-time";

/**
 * "Lage" of one Praxis in the Rückruf-Lage, shared by the Rückruf page and the
 * admin home. Reads only the flags `evaluateEnforcement` already computed.
 */
export function RueckrufLageBadges({ s }: { s: EnforcementState }) {
  return (
    <>
      {s.resumeDue && <Badge tone="bad">Fortsetzen fällig</Badge>}
      {s.canPause && <Badge tone="bad">Pause möglich</Badge>}
      {s.activeWarning && !s.canPause && !s.paused && s.overdueAtCureDeadline === null && (
        <Badge tone="warn">Warnung läuft</Badge>
      )}
      {s.canWarn && <Badge tone="warn">Warnung möglich</Badge>}
    </>
  );
}
