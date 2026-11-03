import { cn } from "@eins/ui";
import { DETAIL_LINES } from "@/app/(portal)/inhalte/_components/parts";
import { DECISION_BAND, MEDIA_FRAME, SLOTS, TITLE_TOP, WELL } from "../_lib/sizes";
import { Frame, PostCard } from "../_components/parts";

const BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
const RAISED_SLOT = "elev-raised h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-raised)]";

/**
 * Without JavaScript the streamed page stays in a hidden `<div id="S:0">`
 * behind this skeleton for good (React swaps it in with a script). The
 * decision works without JavaScript, so then the page shows and the skeleton
 * goes.
 */
const NO_JS = `<style>div[hidden][id^="S:"]{display:block!important}.freigabe-skeleton{display:none!important}</style>`;

/**
 * Same shape as the open post with a two-line title (sizes in
 * `_lib/sizes.ts`), so the file, the text and the two buttons do not move
 * when the page arrives.
 */
export default function Loading() {
  return (
    <>
      <noscript dangerouslySetInnerHTML={{ __html: NO_JS }} />
      <div className="freigabe-skeleton" aria-busy="true" aria-live="polite">
        <Frame>
          <PostCard>
            <div className="elev-raised overflow-hidden rounded-[var(--r-panel)] bg-[var(--surface-raised)]">
              <div className="flex h-11 items-center gap-2 border-b border-border px-3">
                <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[var(--well)]" />
                <span className={cn(BAR, "h-3.5 w-32")} />
              </div>
              <div className={cn("animate-pulse bg-[var(--well)]", MEDIA_FRAME)} />
            </div>
            <div className="min-w-0">
              <div className={TITLE_TOP}>
                <div className="flex h-5 items-center">
                  <div className={cn(BAR, "h-3.5 w-12")} />
                </div>
                <div className="flex h-7 items-center">
                  <div className={cn(BAR, "h-4 w-full")} />
                </div>
                <div className="flex h-7 items-center">
                  <div className={cn(BAR, "h-4 w-2/3")} />
                </div>
              </div>
              <div className="mt-4">
                <div className={cn("elev-inset rounded-[var(--r-panel)] bg-[var(--well)]", WELL)} />
                <div className={DECISION_BAND}>
                  <div className={SLOTS}>
                    <div className={RAISED_SLOT} />
                    <div className={RAISED_SLOT} />
                  </div>
                </div>
              </div>
              {/* The Frist row has two lines, as on the page. */}
              <dl className={cn("mt-4 text-[15px] leading-5", DETAIL_LINES)}>
                <dt>
                  <span className="flex h-5 items-center">
                    <span className={cn(BAR, "h-3.5 w-12")} />
                  </span>
                </dt>
                <dd>
                  <span className="flex h-10 items-start pt-[3px]">
                    <span className={cn(BAR, "h-3.5 w-40 max-w-full")} />
                  </span>
                </dd>
              </dl>
              <div className="mt-3 flex h-5 items-center">
                <div className={cn(BAR, "h-3.5 w-72 max-w-full")} />
              </div>
            </div>
          </PostCard>
        </Frame>
      </div>
    </>
  );
}
