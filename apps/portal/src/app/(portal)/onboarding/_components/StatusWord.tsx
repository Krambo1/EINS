import { StatusDot } from "../../inhalte/_components/parts";

/**
 * The four status words of the onboarding pages, the same everywhere: the hub's
 * steps, the Fragebogen's sections and the Checkliste's items. "Erledigt" is
 * the Praxis's part done, "Geprüft" EINS's confirmation (GitHub's "Review
 * required" and "Changes approved": two steps, two colours).
 */
export type OnboardingStatus = "offen" | "erledigt" | "geprueft" | "entfaellt";

const WORDS: Record<OnboardingStatus, { label: string; dot: string }> = {
  offen: { label: "Offen", dot: "bg-fg-tertiary" },
  erledigt: { label: "Erledigt", dot: "bg-accent" },
  geprueft: { label: "Geprüft", dot: "bg-tone-good" },
  // A ring, so it never reads as "Offen" at a glance.
  entfaellt: { label: "Entfällt", dot: "border border-fg-tertiary" },
};

export function statusLabel(status: OnboardingStatus): string {
  return WORDS[status].label;
}

/** A status as a dot and dark text, never a pill (DESIGN.md section 4). */
export function StatusWord({ status, className }: { status: OnboardingStatus; className?: string }) {
  const w = WORDS[status];
  return (
    <StatusDot dot={w.dot} className={className}>
      {w.label}
    </StatusDot>
  );
}
