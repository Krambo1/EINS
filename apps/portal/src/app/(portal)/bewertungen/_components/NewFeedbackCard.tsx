import Link from "next/link";
import { cn } from "@eins/ui";
import { formatNumber, formatRelative } from "@/lib/formatting";
import type { PatientFeedbackListRow } from "@/server/queries/patient-feedback";
import { DashCard, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { FEEDBACK_ROW_HEIGHT, NEW_FEEDBACK_SLOTS, TOP_CARD_HEIGHT } from "../_lib/sizes";
import { CardLink, CenteredNote, FeedbackSignal, FeedbackStars, feedbackName } from "./feedback-ui";

/**
 * The Rückmeldungen nobody has opened yet, right of the platform tiles on the
 * Plattformen tab: the
 * sidebar counts them on both entries, so the tab shows who they are. Like
 * Linear's inbox: the count beside the title, rows of exactly two lines
 * (name and age, then the stars), the signal in its slot before the name.
 *
 * Always there and always one height (DESIGN.md section 10), beside the
 * platform tiles from xl: three slots, filled or not, "N weitere" at the
 * foot. With nothing new one sentence sits in the slots' space, so neither
 * the tiles nor the cards below move when feedback comes in. The text is
 * left out here (it was cut); it is on the Rückmeldung itself.
 */
export function NewFeedbackCard({
  count,
  rows,
  className,
}: {
  /** All new Rückmeldungen, also beyond the rows shown. */
  count: number;
  /** The newest new Rückmeldungen. */
  rows: PatientFeedbackListRow[];
  className?: string;
}) {
  const shown = rows.slice(0, NEW_FEEDBACK_SLOTS);
  const more = count - shown.length;
  return (
    <DashCard
      title={
        <>
          {/* Short enough for a third at 1400 px beside "Alle ansehen":
              DashCard cuts a longer title. */}
          Neues Feedback
          {count > 0 && (
            <span className="ml-2 font-normal tabular-nums text-fg-secondary">{formatNumber(count)}</span>
          )}
        </>
      }
      action={<CardLink href="/bewertungen/feedback?status=neu">Alle ansehen</CardLink>}
      className={cn("flex flex-col", TOP_CARD_HEIGHT, className)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      {shown.length === 0 ? (
        <div className="flex min-h-0 flex-1">
          <CenteredNote
            title="Kein neues Patientenfeedback."
            text="Neue Rückmeldungen erscheinen hier, sobald Patienten antworten."
          />
        </div>
      ) : (
        // Room for the slots, filled or not; a row whose name wraps scrolls
        // inside instead of growing the card.
        <ul className="scroll-shadows -mx-3 min-h-0 flex-1 divide-y divide-border px-3 [--scroll-bg:var(--surface-tile)]">
          {shown.map((f) => (
            // 4 px white inside the hairlines, the wash 12 px past the text (DESIGN.md section 5).
            <li key={f.id} className={WASH_ROW}>
              <Link
                // In the "Neu" list, so the arrows on the entry go through the new ones.
                href={`/bewertungen/feedback/${f.id}?status=neu`}
                className={cn(
                  "flex items-start gap-2.5 rounded-[var(--r-panel)] py-3 transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                  WASH_AREA,
                  FEEDBACK_ROW_HEIGHT
                )}
              >
                <FeedbackSignal row={f} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    {/* Long names wrap, never cut. */}
                    <span className="min-w-0 break-words text-[15px] font-medium leading-5 text-fg-primary">
                      {feedbackName(f.contactName)}
                    </span>
                    <span className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary">
                      {formatRelative(f.createdAt)}
                    </span>
                  </span>
                  <span className="mt-1 flex h-5 items-center">
                    <FeedbackStars rating={f.rating} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 h-5 shrink-0 text-sm leading-5 text-fg-secondary">
        {more > 0 && (
          <>
            <span className="tabular-nums">{formatNumber(more)}</span>{" "}
            {more === 1 ? "weitere neue Rückmeldung" : "weitere neue Rückmeldungen"}
          </>
        )}
      </p>
    </DashCard>
  );
}
