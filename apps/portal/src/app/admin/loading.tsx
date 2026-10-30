/**
 * Shape of the admin Übersicht (no page header, the thirds grid): Garantie-
 * Uhr | Rückruf-Lage, three number tiles, the Anfragen panel, the Praxen
 * table. Same radius and gap as the real panels so nothing jumps on load.
 */
export default function Loading() {
  const block = "animate-pulse rounded-md border border-border bg-bg-secondary";
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <section className="grid gap-4 lg:grid-cols-3">
        <div className={`h-28 lg:col-span-2 ${block}`} />
        <div className={`h-28 ${block}`} />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-20 ${block}`} />
        ))}
      </section>

      <div className={`h-64 ${block}`} />
      <div className={`h-40 ${block}`} />
    </div>
  );
}
