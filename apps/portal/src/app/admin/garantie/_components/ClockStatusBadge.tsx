import { Badge } from "@eins/ui";
import { CLOCK_STATUS_LABELS, type ClockStatus } from "@/lib/guarantee-clock";

const TONE: Record<ClockStatus, "neutral" | "accent" | "good" | "warn" | "bad"> = {
  ohne_startdatum: "neutral",
  laeuft: "accent",
  rechnung_faellig: "good",
  beendet_ohne_anfrage: "bad",
  beendet_durch_praxis: "neutral",
  beendet_plattform_stoerung: "warn",
};

export function ClockStatusBadge({ status }: { status: ClockStatus }) {
  return <Badge tone={TONE[status]}>{CLOCK_STATUS_LABELS[status]}</Badge>;
}
