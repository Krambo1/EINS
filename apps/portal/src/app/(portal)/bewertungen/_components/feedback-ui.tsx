import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, PhoneCall } from "lucide-react";
import { cn } from "@eins/ui";
import { BrandLogo } from "@/app/_components/Brand";
import { PATIENT_FEEDBACK_STATUS_LABELS, type PatientFeedbackStatus } from "@/lib/constants";
import { RatingStars } from "../../_components/RatingStars";
import { HOVER_CARD } from "../../dashboard/_components/hover-card";

/**
 * Small parts every Bewertungen view shares (the Plattformen card, the list,
 * the detail), so a Rückmeldung reads the same everywhere.
 */

/** Dot colour per status: waiting, seen, answered, closed. */
const STATUS_DOT: Record<PatientFeedbackStatus, string> = {
  neu: "bg-tone-warn",
  gesehen: "bg-accent",
  beantwortet: "bg-tone-good",
  geschlossen: "bg-fg-tertiary",
};

/** The status as a coloured dot and plain dark text (DESIGN.md section 5). */
export function FeedbackStatus({ status, className }: { status: PatientFeedbackStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-5 text-fg-primary",
        className
      )}
    >
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status])} />
      {PATIENT_FEEDBACK_STATUS_LABELS[status]}
    </span>
  );
}

/** Five stars, the rating for screen readers ("2 von 5 Sternen"). */
export function FeedbackStars({ rating, size = 14 }: { rating: number; size?: number }) {
  return <RatingStars rating={rating} size={size} className="align-[-2px]" />;
}

export const PLATFORM_NAME: Record<"google" | "jameda", string> = {
  google: "Google",
  jameda: "Jameda",
};

/** Name of the person, or what stands in for it. */
export function feedbackName(name: string | null): string {
  return name?.trim() || "Ohne Namen";
}

interface SignalRow {
  contactBackOk: boolean;
  source: "private" | "public_redirect";
  publicPlatform: "google" | "jameda" | null;
}

/**
 * What only some Rückmeldungen have, as one icon in a fixed slot before the
 * name (Linear's issue list): a phone for "Rückruf gewünscht", the platform's
 * logo for a patient sent on to Google or Jameda. The words float in a hover
 * card; screen readers get them as text. Every row keeps its height and
 * every name starts at the same x.
 */
export function FeedbackSignal({ row, className }: { row: SignalRow; className?: string }) {
  const isPublic = row.source === "public_redirect" && row.publicPlatform;
  const text = isPublic
    ? `Bei ${PLATFORM_NAME[row.publicPlatform!]} bewertet`
    : row.contactBackOk
      ? "Rückruf gewünscht"
      : null;
  return (
    <span className={cn("group/sig relative flex h-5 w-4 shrink-0 items-center justify-center", className)}>
      {text && (
        <>
          <span aria-hidden>
            {isPublic ? (
              <BrandLogo brand={row.publicPlatform!} className="h-4 w-4" />
            ) : (
              <PhoneCall className="h-4 w-4 text-tone-warn" />
            )}
          </span>
          <span className="sr-only">{text}. </span>
          <span aria-hidden className={cn(HOVER_CARD, "-left-3 hidden group-hover/sig:block")}>
            <span className="block text-sm font-semibold leading-5 text-fg-primary">{text}</span>
            <span className="mt-1 block text-sm leading-5 text-fg-primary">
              {isPublic
                ? "Weitergeleitet zur öffentlichen Bewertung, kein vertraulicher Text."
                : "Die Person erlaubt, dass Sie sich zu dieser Rückmeldung melden."}
            </span>
          </span>
        </>
      )}
    </span>
  );
}

/** Room the signal slot takes before a name: the 16 px slot and its gap. */
export const SIGNAL_INDENT = "pl-[1.625rem]";

/** "Alle ansehen" and the like at the right end of a card header. */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-[var(--r-small)] text-sm font-medium text-fg-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** One sentence in the middle of a card's empty space. */
export function CenteredNote({ title, text }: { title: string; text?: string }) {
  return (
    <div className="m-auto max-w-sm px-4 text-center">
      <p className="text-[15px] font-medium leading-6 text-fg-primary">{title}</p>
      {text && <p className="mt-1 text-sm leading-5 text-fg-secondary">{text}</p>}
    </div>
  );
}
