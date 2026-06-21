import Link from "next/link";
import { ClipboardCheck, ArrowRight } from "lucide-react";

/**
 * Slim, persistent nudge shown on the data tabs once the access gate is open
 * (Fragebogen + Blocker items done) but the full mandatory checklist still has
 * open items. Not dismissible by design: it simply disappears when the last
 * required item is delivered. Inhaber-only (rendered only for that role in the
 * layout).
 */
export function ChecklistReminderBanner({ remaining }: { remaining: number }) {
  return (
    <Link
      href="/onboarding/checkliste"
      className="mb-6 flex items-center gap-3 rounded-xl border border-accent/40 bg-bg-secondary px-4 py-3 text-sm transition-colors hover:border-accent"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/40 text-accent">
        <ClipboardCheck className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 text-fg-primary">
        <span className="font-semibold">
          Noch {remaining} {remaining === 1 ? "Pflichtpunkt" : "Pflichtpunkte"} in
          Ihrer Start-Checkliste offen.
        </span>{" "}
        <span className="text-fg-secondary">
          Damit wir Anzeigen, Zielseite und Videos fertig aufsetzen können.
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-fg-secondary" />
    </Link>
  );
}
