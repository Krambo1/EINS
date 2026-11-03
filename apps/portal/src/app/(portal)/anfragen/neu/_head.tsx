import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import { PageHeader } from "../../_components/PageHeader";
import { CONTROL_SQUARE, QUIET_CONTROL } from "../../dashboard/_components/dash-ui";

/**
 * The head of "Anfrage anlegen", on the logo row like every page head
 * (Einstellungen' `SettingsHead`). From md the way back is a trail before
 * the title, "Anfragen › Anfrage anlegen" (Linear's top row); on the phone a
 * back chevron, then the title.
 */
export function AnfrageAnlegenHead() {
  return (
    <PageHeader
      title={
        <span className="flex min-w-0 items-center">
          <Link
            href="/anfragen"
            aria-label="Zurück zu Anfragen"
            className={cn(QUIET_CONTROL, CONTROL_SQUARE, "-ml-2.5 shrink-0 justify-center text-fg-primary md:hidden")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          <Link
            href="/anfragen"
            className="hidden shrink-0 rounded-[var(--r-small)] text-fg-secondary decoration-fg-tertiary underline-offset-4 hover:text-fg-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:inline"
          >
            Anfragen
          </Link>
          <ChevronRight aria-hidden className="mx-1 hidden h-5 w-5 shrink-0 text-fg-tertiary md:block" />
          <span className="min-w-0">Anfrage anlegen</span>
        </span>
      }
    />
  );
}
