import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import { PageHeader } from "../../_components/PageHeader";
import { CONTROL_SQUARE, QUIET_CONTROL } from "../../dashboard/_components/dash-ui";

/**
 * The head of the three onboarding pages: the title on the first row, the
 * count at its right end (Shopify's "0 out of 3 steps completed", plain
 * text). The Fragebogen and the Checkliste lead with the way back as a
 * trail, "Erste Schritte › Fragebogen" (Linear's top row); on the phone the
 * trail is a back chevron and the title.
 */
export function OnboardingHead({
  title,
  back = false,
  count,
}: {
  title: string;
  /** An inner page: the trail back to Erste Schritte. */
  back?: boolean;
  /** "2 von 5 erledigt" and the like; or the page's one button. */
  count?: ReactNode;
}) {
  return (
    <PageHeader
      title={
        back ? (
          <span className="flex min-w-0 items-center">
            <Link
              href="/onboarding"
              aria-label="Zurück zu Erste Schritte"
              className={cn(QUIET_CONTROL, CONTROL_SQUARE, "-ml-2.5 justify-center text-fg-primary md:hidden")}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/onboarding"
              className="hidden rounded-[var(--r-small)] text-fg-secondary decoration-fg-tertiary underline-offset-4 hover:text-fg-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:inline"
            >
              Erste Schritte
            </Link>
            <ChevronRight aria-hidden className="mx-1 hidden h-5 w-5 shrink-0 text-fg-tertiary md:block" />
            <span className="min-w-0 truncate">{title}</span>
          </span>
        ) : (
          title
        )
      }
      actions={count}
    />
  );
}

/** The count in the head: plain grey text, tabular figures (Shopify's "0 out of 3 steps completed"). */
export function HeadCount({ children }: { children: ReactNode }) {
  return <p className="whitespace-nowrap text-[15px] leading-5 tabular-nums text-fg-secondary">{children}</p>;
}

/**
 * The one line under a page's head, only for a rule the owner acts on: why
 * the portal is still locked, that estimates are fine, never to share a
 * password. Never a description of the page.
 */
export function PageNote({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-[15px] leading-6 text-fg-primary">{children}</p>;
}
