/**
 * Deterministic, SSR-stable DOM id derived purely from its inputs — NOT from
 * React's `useId()`.
 *
 * Why not `useId()`: these ids label inline-SVG gradient defs that are
 * referenced by `fill="url(#id)"` in the same chart. `useId()` is positional,
 * and its base drifts between the server and the client when the chart sits
 * inside a `<Suspense>` boundary that suspends during SSR and streams in a
 * later flush (exactly the EINS dashboard layout). That drift produces a
 * hydration mismatch on the gradient `id` / `fill` attributes — cosmetic but
 * noisy, and it can briefly leave a `url(#…)` fill pointing at a def the
 * client renumbered.
 *
 * A hash of the chart's own geometry+tone is identical on server and client
 * (same props in, same string out), so it never drifts. Collisions are
 * harmless by construction: the only way two charts share an id is identical
 * `seed` (same tone + same path), which means their gradient defs are
 * byte-identical too, so a shared `url(#id)` reference paints the same fill.
 */
export function stableId(prefix: string, seed: string): string {
  // djb2 — tiny, fast, good enough spread for de-duping a handful of charts.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (((h << 5) + h) ^ seed.charCodeAt(i)) >>> 0;
  }
  return `${prefix}-${h.toString(36)}`;
}
