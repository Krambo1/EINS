/**
 * Skeletons of the Übersicht, each card with the fixed height of the card it
 * stands in for (DESIGN.md section 10, "Fixed size"): the numbers are the
 * measured heights of the real cards at the same breakpoints. Update them
 * whenever a card's height changes (run `fixed-size-dashboard.cjs` and read
 * the heights from its output).
 */
const TILE = "elev-card animate-pulse rounded-[var(--r-card)] bg-[var(--surface-tile)]";

/**
 * The Kennzahlen (the Anfragen panel and the 2 x 2 block) and the row of
 * Offene Anfragen and Quellen under them.
 */
export function TopMetricsSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true">
      <section
        aria-label="Kennzahlen werden geladen"
        className="grid gap-4 md:gap-6 xl:grid-cols-2"
      >
        <div className={`${TILE} h-[340px] md:h-[360px]`} />
        <div className="elev-card grid gap-px overflow-hidden rounded-[var(--r-card)] bg-border md:grid-cols-2 xl:h-[360px] xl:grid-rows-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[98px] animate-pulse bg-[var(--surface-tile)] md:h-[176px] xl:h-auto"
            />
          ))}
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <div className={`${TILE} h-[25.75rem] lg:h-[35rem]`} />
        <div className={`${TILE} h-[36.5rem] sm:h-[35rem]`} />
      </div>
    </div>
  );
}

/**
 * Skeleton rendered while the detail bundle's queries are in flight: Inhalte,
 * Trichter, Behandlungen and Reputation, full width. (Standorte follows only
 * for a Praxis with several Standorte; the skeleton does not know that yet.)
 */
export function DetailBundleSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true" aria-live="polite">
      {/* Inhalte: a list below lg, a table from lg, four tiles from xl. */}
      <div className={`${TILE} h-[467px] md:h-[475px] lg:h-[511px] xl:h-[432px]`} />
      {/* Trichter: rows below xl, columns from xl. */}
      <div className={`${TILE} h-[676px] sm:h-[559px] md:h-[700px] lg:h-[575px] xl:h-[483px]`} />
      {/* Behandlungen. */}
      <div className={`${TILE} h-[545px] md:h-[553px] lg:h-[589px]`} />
      <div className={`${TILE} h-[264px] sm:h-[164px] md:h-[172px]`} />
    </div>
  );
}
