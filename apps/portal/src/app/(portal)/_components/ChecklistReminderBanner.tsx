import Link from "next/link";
import { Button, cn } from "@eins/ui";
import { SECONDARY_BUTTON } from "../einstellungen/_components/settings-ui";

/**
 * Slim, persistent nudge shown on the data tabs once the access gate is open
 * (Fragebogen + Blocker items done) but the full mandatory checklist still has
 * open items. Not dismissible by design: it simply disappears when the last
 * required item is delivered. Inhaber-only (rendered only for that role in the
 * layout).
 *
 * A white strip like a card: the count, and "Zur Checkliste" at its right end
 * (Primer's Banner with an action, Stripe's "Action required"). One line from
 * md. The gap to the columns below is padding, not margin, so the shell's
 * measured height (--shell-notice) includes it and the sidebar fits. Strip
 * and gap are 5.5rem at every width (72 + 16 on the phone, 64 + 24 from md),
 * the shell's guess before it measures.
 */
export function ChecklistReminderBanner({ remaining }: { remaining: number }) {
  return (
    <div className="pb-4 md:pb-6">
      <div className="elev-card flex min-h-[4.5rem] items-center gap-3 rounded-[var(--r-panel)] bg-[var(--surface-tile)] py-3 pl-4 pr-3 md:min-h-0 md:pl-5">
        <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-fg-primary">
          Noch {remaining} {remaining === 1 ? "Pflichtpunkt" : "Pflichtpunkte"} in
          Ihrer Start-Checkliste offen.
        </p>
        <Button asChild variant="outline" className={cn(SECONDARY_BUTTON, "shrink-0")}>
          <Link href="/onboarding/checkliste">Zur Checkliste</Link>
        </Button>
      </div>
    </div>
  );
}
