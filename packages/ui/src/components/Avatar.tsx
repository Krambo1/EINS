import { forwardRef } from "react";
import { User } from "lucide-react";
import { cn } from "../lib/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
  xl: "h-20 w-20 text-base",
};

const ICON_SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
  xl: "h-10 w-10",
};

/**
 * Derive 1–2 uppercase initials from a name or e-mail. Single-word inputs
 * (or e-mails) take the first two alphabetic chars; multi-word inputs take
 * the first letter of the first and last token.
 */
export function initialsOf(nameOrEmail: string | null | undefined): string {
  const cleaned = (nameOrEmail ?? "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  const letters = cleaned.replace(/[^a-zA-ZÀ-ÿ]/g, "");
  return (letters.slice(0, 2) || cleaned.slice(0, 2)).toUpperCase();
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Image URL. If null/missing/broken, falls back to initials. */
  src?: string | null;
  /** Used for the initials fallback AND the `alt` text. */
  name: string | null | undefined;
  size?: AvatarSize;
}

/**
 * Circular profile picture. Renders the image when `src` is given; otherwise
 * a colored chip with the user's initials, sized by the `size` prop.
 *
 * We use a plain <img> rather than next/image so the component works inside
 * @eins/ui (no Next-only import) and inside any host app, including the
 * marketing site. The image fetch is lazy by default.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { src, name, size = "md", className, ...rest },
  ref
) {
  const sizeClasses = SIZE_CLASSES[size];
  const iconSizeClasses = ICON_SIZE_CLASSES[size];

  return (
    <span
      ref={ref}
      aria-label={name ?? undefined}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-accent-soft font-semibold uppercase tracking-wide text-accent",
        sizeClasses,
        className
      )}
      {...rest}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <User aria-hidden className={iconSizeClasses} />
      )}
    </span>
  );
});
