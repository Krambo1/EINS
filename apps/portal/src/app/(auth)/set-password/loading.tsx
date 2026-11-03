import { cn } from "@eins/ui";
import { CONTROL } from "@/app/(portal)/dashboard/_components/dash-ui";
import { AuthSkeletonShell } from "../_components/AuthShell";
import { PasswordRules } from "../_components/PasswordRules";
import {
  AUTH_BODY_GAP,
  AUTH_STACK,
  AUTH_TITLE_GAP,
  FIELD_LABEL_ROW,
  SKELETON_BAR,
  SKELETON_TITLE,
} from "../_lib/sizes";

/** A label row and its field, or the e-mail line, as the page has them. */
function FieldBlock({ value = false }: { value?: boolean }) {
  return (
    <div>
      <div className={FIELD_LABEL_ROW}>
        <div className={cn(SKELETON_BAR, "h-3.5 w-24")} />
      </div>
      <div className="mt-1.5">
        {value ? (
          <div className="flex h-6 items-center">
            <div className={cn(SKELETON_BAR, "h-4 w-56 max-w-full")} />
          </div>
        ) : (
          <div className={cn(CONTROL, SKELETON_BAR, "w-full")} />
        )}
      </div>
    </div>
  );
}

/**
 * Passwort setzen while it loads: title, the e-mail, both fields, the rules
 * (the real ones, all open, so they wrap as on the page) and the button, at
 * their sizes under the card's logo. Without JavaScript the page replaces
 * it (AuthSkeletonShell).
 */
export default function Loading() {
  return (
    <AuthSkeletonShell>
      <div aria-busy="true" aria-live="polite" aria-label="Wird geladen">
        <div className={AUTH_TITLE_GAP}>
          <div className={SKELETON_TITLE} />
        </div>
        <div className={cn(AUTH_BODY_GAP, AUTH_STACK)}>
          <FieldBlock value />
          <div className={AUTH_STACK}>
            <FieldBlock />
            <FieldBlock />
            <PasswordRules id="password-rules-loading" pw="" pw2="" />
            <div className={cn(CONTROL, SKELETON_BAR, "w-full")} />
          </div>
        </div>
      </div>
    </AuthSkeletonShell>
  );
}
