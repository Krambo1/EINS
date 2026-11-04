import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@eins/ui";

/**
 * The portal's toast look (Linear, Vercel): a solid white card in the popover
 * layer, dark text, and the tone only in a small icon before the title.
 * Before, title and text were set in red or green on a tinted pink or green
 * card, which was hard to read (Karam, 2026-11-03). Used by the portal's
 * ActionFlashToast and the sign-in pages' AuthToast.
 */
export const TOAST_CARD =
  // The popover shadow as an important arbitrary value: the shared Toast
  // brings shadow-lg, and two shadow classes would race on CSS order.
  "pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-[var(--r-panel)] border-0 bg-bg-primary py-3.5 pl-3.5 pr-10 text-fg-primary ![box-shadow:var(--elev-popover)] [background-image:none]";

export const TOAST_TITLE = "text-[15px] font-semibold leading-5 text-fg-primary";
export const TOAST_TEXT = "text-sm leading-5 text-fg-secondary";

/** The close cross: 32 px to tap, in the top right corner. */
export const TOAST_CLOSE =
  "absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-[var(--r-control)] text-fg-secondary opacity-100 transition-colors hover:bg-[var(--hover-wash)] hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary";

/** The tone as an icon at the height of the title's first line. */
export function ToastIcon({ tone, className }: { tone: "good" | "bad"; className?: string }) {
  const Icon = tone === "bad" ? CircleAlert : CircleCheck;
  return (
    <Icon
      aria-hidden
      className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "bad" ? "text-tone-bad" : "text-tone-good", className)}
    />
  );
}
