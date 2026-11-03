import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import { PageHeader } from "../../_components/PageHeader";
import { CONTROL_SQUARE, QUIET_CONTROL } from "../../dashboard/_components/dash-ui";

export type Crumb = { href: string; label: string };

export const EINSTELLUNGEN: Crumb = { href: "/einstellungen", label: "Einstellungen" };
/** For the pages reached from a Werbekonten row: back to that card. */
export const WERBEKONTEN: Crumb = { href: "/einstellungen#werbekonten", label: "Einstellungen" };
export const PRAXIS_SOFTWARE: Crumb = { href: "/einstellungen/integrationen", label: "Praxis-Software" };
export const ANBINDUNG_WAEHLEN: Crumb = { href: "/einstellungen/integrationen/setup", label: "Anbindung wählen" };

/**
 * The head of a page below Einstellungen, on the logo row like every page
 * head. From xl the way back is a trail before the title, "Einstellungen ›
 * Praxis-Software › CSV-Datei laden" (Linear's top row; the onboarding
 * pages' `OnboardingHead`). Below xl, where a trail of three would not fit
 * the row, a back chevron to the page one up, then the title.
 */
export function SettingsHead({
  title,
  trail = [EINSTELLUNGEN],
  actions,
}: {
  title: string;
  /** The pages above, top first; the last one is where the chevron leads. */
  trail?: Crumb[];
  actions?: ReactNode;
}) {
  const up = trail[trail.length - 1];
  return (
    <PageHeader
      title={
        <span className="flex min-w-0 items-center">
          <Link
            href={up.href}
            aria-label={`Zurück zu ${up.label}`}
            className={cn(QUIET_CONTROL, CONTROL_SQUARE, "-ml-2.5 shrink-0 justify-center text-fg-primary xl:hidden")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          {trail.map((c) => (
            <Fragment key={c.href}>
              <Link
                href={c.href}
                className="hidden shrink-0 rounded-[var(--r-small)] text-fg-secondary decoration-fg-tertiary underline-offset-4 hover:text-fg-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent xl:inline"
              >
                {c.label}
              </Link>
              <ChevronRight aria-hidden className="mx-1 hidden h-5 w-5 shrink-0 text-fg-tertiary xl:block" />
            </Fragment>
          ))}
          <span className="min-w-0">{title}</span>
        </span>
      }
      actions={actions}
    />
  );
}
