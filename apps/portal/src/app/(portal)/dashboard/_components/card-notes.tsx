import type { ReactNode } from "react";
import { cn } from "@eins/ui";

/**
 * One plain sentence in place of an empty chart, as quiet text without a box
 * of its own (no card inside the card). It sits right under the card title,
 * like every other line on the page, with no reserved chart height below it:
 * blank space under one sentence reads as something failing to load.
 */
export function CardEmptyNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cn("text-[15px] text-fg-secondary", className)}>{children}</p>;
}
