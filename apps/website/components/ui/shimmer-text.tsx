import { cn } from "@/lib/utils";

interface ShimmerTextProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * EINS-mint text with a highlight band sweeping across.
 * Pure CSS (see .shimmer-text in globals.css) — no framer-motion to avoid
 * it stomping on the background-clip properties during animation.
 */
export function ShimmerText({ children, className }: ShimmerTextProps) {
  return (
    <span className={cn("shimmer-text inline-block", className)}>
      {children}
    </span>
  );
}

export default ShimmerText;
