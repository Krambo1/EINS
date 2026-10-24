import { Badge } from "@eins/ui";
import type { GuaranteeOverviewRow } from "@/server/guarantee-clock";

/**
 * Open points of one Praxis on the Garantie-Uhr, shared by the overview page
 * and the admin home so both read the same flags from `listGuaranteeOverview`.
 * `invoiceUnsent` is only known where the caller loaded the invoice dates.
 */
export function GuaranteeOpenBadges({
  r,
  invoiceUnsent = false,
}: {
  r: GuaranteeOverviewRow;
  invoiceUnsent?: boolean;
}) {
  return (
    <>
      {r.hasCandidate && <Badge tone="accent">Kandidat prüfen</Badge>}
      {invoiceUnsent && <Badge tone="bad">Rechnung nicht als gesendet vermerkt</Badge>}
      {r.openDelayCount > 0 && <Badge tone="warn">Verzug läuft</Badge>}
      {/* K-13: an open Verzug has no cap; flag it once it runs long. */}
      {r.oldestOpenDelayDays >= 30 && (
        <Badge tone="bad">Verzug seit {r.oldestOpenDelayDays} Tagen offen</Badge>
      )}
      {r.unnotifiedDelayCount > 0 && <Badge tone="warn">Nicht mitgeteilt, zählt noch nicht</Badge>}
    </>
  );
}
