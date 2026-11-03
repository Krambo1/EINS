"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import { PageHeader } from "../../_components/PageHeader";
import { CONTROL_SQUARE, QUIET_CONTROL } from "../../dashboard/_components/dash-ui";

/**
 * The head of a page below "Nachrichten an EINS", on the logo row like every
 * page head (Einstellungen' `SettingsHead`). From md the way back is a trail
 * before the title, "Nachrichten an EINS › Betreff" (Linear's top row); on
 * the phone a back chevron, then the title. A long title wraps.
 *
 * `onBack` takes a plain click on the way back (the new message goes back to
 * the list in place); a click with a modifier stays a link.
 */
export function SupportHead({
  title,
  actions,
  onBack,
}: {
  title: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
}) {
  const back = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onBack || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onBack();
  };
  return (
    <PageHeader
      title={
        // Phone: chevron and title side by side. From md one line of text,
        // so a long title wraps under the trail across the full width.
        <span className="flex min-w-0 items-start md:block">
          <Link
            href="/support"
            onClick={back}
            aria-label="Zurück zu Nachrichten an EINS"
            className={cn(QUIET_CONTROL, CONTROL_SQUARE, "-ml-2.5 shrink-0 justify-center text-fg-primary md:hidden")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          <Link
            href="/support"
            onClick={back}
            className="hidden rounded-[var(--r-small)] text-fg-secondary decoration-fg-tertiary underline-offset-4 hover:text-fg-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:inline"
          >
            Nachrichten an EINS
          </Link>
          <ChevronRight aria-hidden className="mx-1 hidden h-5 w-5 align-[-0.125rem] text-fg-tertiary md:inline-block" />
          <span className="min-w-0 py-1.5 md:inline md:py-0">{title}</span>
        </span>
      }
      actions={actions}
    />
  );
}
