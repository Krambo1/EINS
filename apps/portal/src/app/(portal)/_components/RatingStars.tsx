import { Star } from "lucide-react";

/**
 * 5-star rating visualizer with fractional fill. The foreground row is a
 * second copy of the stars, clipped horizontally to `(rating / 5) * 100%`,
 * so 4.7 renders as four solid stars and one ~70%-filled star.
 */
export function RatingStars({
  rating,
  size = 16,
  className,
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, rating));
  const pct = (clamped / 5) * 100;
  const innerWidth = size * 5;
  return (
    <span
      role="img"
      aria-label={`${clamped.toFixed(1).replace(".", ",")} von 5 Sternen`}
      className={`relative inline-flex shrink-0 leading-none ${className ?? ""}`}
      style={{ width: innerWidth, height: size }}
    >
      <span className="flex text-fg-tertiary/50">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={size} aria-hidden />
        ))}
      </span>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 overflow-hidden text-tone-warn"
        style={{ width: `${pct}%` }}
      >
        <span className="flex" style={{ width: innerWidth }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star
              key={i}
              size={size}
              className="shrink-0 fill-current"
            />
          ))}
        </span>
      </span>
    </span>
  );
}
