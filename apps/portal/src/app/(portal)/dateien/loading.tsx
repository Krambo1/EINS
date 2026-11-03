import { cn } from "@eins/ui";
import { PageHeader } from "../_components/PageHeader";
import { WASH_AREA } from "../dashboard/_components/dash-ui";
import { FILE_LIST, FILE_ROW, FILE_SLOTS, FilesCard, SKELETON_BAR } from "./_components/file-ui";

const RAISED_SLOT = "elev-raised block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-raised)]";

/**
 * Same frame as the page (FilesCard): the title row, then both cards with
 * their header control (the Art filter, "Dateien senden") and six row slots
 * each, so nothing moves when the files arrive.
 */
export default function Loading() {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader title="Dateien" />
      <div className="grid gap-4 md:gap-6 xl:grid-cols-2">
        <FilesCard
          title="Von EINS"
          action={
            <span className="flex gap-2">
              {/* "Alle herunterladen": a square, the words where the card is wide. */}
              <span
                className={cn(
                  RAISED_SLOT,
                  "w-[var(--control-h)] [@container(min-width:31rem)]:w-[11.5rem]"
                )}
              />
              <span className={cn(RAISED_SLOT, "w-[9.375rem]")} />
            </span>
          }
          className="[container-type:inline-size]"
        >
          <SkeletonRows />
        </FilesCard>
        <FilesCard
          title="An EINS gesendet"
          action={<span className={cn(RAISED_SLOT, "w-28 md:w-40")} />}
        >
          <SkeletonRows />
        </FilesCard>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className={FILE_LIST}>
      {Array.from({ length: FILE_SLOTS }).map((_, i) => (
        <li key={i} className={cn("flex items-center gap-3", WASH_AREA, FILE_ROW)}>
          <span className={cn(SKELETON_BAR, "h-4 w-4 shrink-0 self-start mt-0.5")} />
          <div className="min-w-0 flex-1">
            <div className="flex h-5 items-center">
              <div className={cn(SKELETON_BAR, "h-4 w-48 max-w-full")} />
            </div>
            {/* Below lg most names take a second line (88 px rows). */}
            <div className="flex h-5 items-center lg:hidden">
              <div className={cn(SKELETON_BAR, "h-4 w-28 max-w-full")} />
            </div>
            <div className="mt-1 flex h-5 items-center">
              <div className={cn(SKELETON_BAR, "h-3.5 w-32 max-w-full")} />
            </div>
          </div>
          <span className={cn(RAISED_SLOT, "w-[var(--control-h)] shrink-0")} />
        </li>
      ))}
    </ul>
  );
}
