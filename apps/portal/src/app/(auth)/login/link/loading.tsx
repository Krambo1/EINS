import { cn } from "@eins/ui";
import { CONTROL } from "@/app/(portal)/dashboard/_components/dash-ui";
import { AuthSkeletonShell } from "../../_components/AuthShell";
import { AUTH_BODY_GAP, AUTH_TITLE_GAP, SKELETON_BAR, SKELETON_TITLE } from "../../_lib/sizes";

/**
 * The link page while it loads: the title and the one button at their
 * sizes, under the card's logo, so nothing moves when the page arrives.
 * Without JavaScript the page replaces it (AuthSkeletonShell).
 */
export default function Loading() {
  return (
    <AuthSkeletonShell>
      <div aria-busy="true" aria-live="polite" aria-label="Link wird geprüft">
        <div className={AUTH_TITLE_GAP}>
          <div className={SKELETON_TITLE} />
        </div>
        <div className={AUTH_BODY_GAP}>
          <div className={cn(CONTROL, SKELETON_BAR, "w-full")} />
        </div>
      </div>
    </AuthSkeletonShell>
  );
}
