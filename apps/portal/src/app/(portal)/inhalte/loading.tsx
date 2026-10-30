import { Fragment } from "react";
import { cn } from "@eins/ui";
import { DashCard, TABLE_HEAD_BAND } from "../dashboard/_components/dash-ui";
import { PageHeader } from "../_components/PageHeader";
import {
  DETAIL_LINES,
  FREIGABE_CARD_HEIGHT,
  PAGE_SIZE,
  POST_ROW,
  POSTS_CARD_HEIGHT,
  PREVIEW_FRAME,
  TITLE_BLOCK,
} from "./_components/parts";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const RAISED_SLOT = "elev-raised h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-raised)]";

/**
 * Same shape as the page: the title, then the two cards with the fixed
 * heights of the real ones (shared constants in parts.tsx), so nothing
 * jumps when the page arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader title="Inhalte" />

      <DashCard
        title="Zur Freigabe"
        action={<div className="h-[var(--control-h)]" />}
        className={cn("flex flex-col", FREIGABE_CARD_HEIGHT)}
        bodyClassName="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-6"
      >
        <div className={cn("elev-raised flex flex-col overflow-hidden rounded-[var(--r-panel)] bg-[var(--surface-raised)]", PREVIEW_FRAME)}>
          <div className="h-11 shrink-0 border-b border-border" />
          <div className="flex-1 animate-pulse bg-[var(--well)]" />
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-col lg:mt-0">
          <div className={cn(TITLE_BLOCK, "items-center")}>
            <div className={cn(BAR, "h-5 w-64 max-w-full")} />
          </div>
          <dl className={cn("mt-3", DETAIL_LINES)}>
            {/* The Frist row has two lines, as on the card. */}
            {[1, 1, 1, 2, 1].map((lines, i) => (
              <Fragment key={i}>
                <dt>
                  <span className="flex h-5 items-center">
                    <span className={cn(BAR, "h-3.5 w-16")} />
                  </span>
                </dt>
                <dd>
                  <span className={cn("flex items-start pt-[3px]", lines === 2 ? "h-10" : "h-5")}>
                    <span className={cn(BAR, "h-3.5 w-40 max-w-full")} />
                  </span>
                </dd>
              </Fragment>
            ))}
          </dl>
          <div className="mt-4 flex h-5 items-center">
            <div className={cn(BAR, "h-3.5 w-28")} />
          </div>
          <div className="elev-inset mt-1.5 min-h-0 flex-1 rounded-[var(--r-panel)] bg-[var(--well)]" />
          <div className="shrink-0 pt-5">
            <div className="border-t border-border pt-4">
              <div className="mb-2 flex h-5 items-center">
                <div className={cn(BAR, "h-3.5 w-28")} />
              </div>
              <div className="grid h-[var(--control-h)] grid-cols-2 gap-2 sm:w-[23rem]">
                <div className={RAISED_SLOT} />
                <div className={RAISED_SLOT} />
              </div>
            </div>
          </div>
        </div>
      </DashCard>

      <DashCard
        title="Alle Beiträge"
        action={<div className={cn(BAR, "h-[var(--control-h)] w-[11.5rem] rounded-[var(--r-control)]")} />}
        className={cn("flex flex-col", POSTS_CARD_HEIGHT)}
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        <div className={cn("hidden shrink-0 lg:block", TABLE_HEAD_BAND)} />
        <ul className="-mx-2 min-h-0 flex-1 divide-y divide-border overflow-hidden px-2 lg:mt-1">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <li
              key={i}
              className={cn(
                "grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-1 px-2 lg:grid-cols-[5.25rem_minmax(0,1fr)]",
                POST_ROW
              )}
            >
              <div className={cn(BAR, "h-12 w-12 rounded-[var(--r-control)] lg:w-[5.25rem]")} />
              <div className="min-w-0 space-y-1 px-2">
                <div className="flex h-5 items-center">
                  <div className={cn(BAR, "h-4 w-48 max-w-full")} />
                </div>
                <div className="flex h-5 items-center lg:hidden">
                  <div className={cn(BAR, "h-3.5 w-36")} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </DashCard>
    </div>
  );
}
