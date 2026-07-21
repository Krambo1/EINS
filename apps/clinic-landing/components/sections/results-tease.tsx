import type { Clinic } from "@/lib/types";

/**
 * Section 6 — ResultsTease (NEW).
 *
 * Seit BGH 31.07.2025 (I ZR 170/24) sind Vorher-Nachher-Bilder auch für
 * Injektabels in der Werbung verboten. Dieses Modul dreht das Verbot in
 * einen Beratungsgrund: echte Behandlungsbeispiele gibt es im persönlichen
 * Gespräch — rechtlich sauber und ein konkreter Mehrwert, den nur der
 * Termin liefert. Kein Bildmaterial, bewusst.
 */
export function ResultsTease({ clinic }: { clinic: Clinic }) {
  return (
    <section className="bg-brand-bg">
      <div className="container mx-auto max-w-3xl py-16 text-center md:py-24">
        <p className="eyebrow">Echte Ergebnisse</p>
        <h2 className="mt-3">
          Behandlungsbeispiele zeigen wir Ihnen im persönlichen Gespräch
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-brand-fg-muted md:text-lg">
          Der Gesetzgeber untersagt Vergleichsbilder in der Werbung, und das aus gutem Grund:
          Sie sagen wenig darüber aus, was bei Ihnen möglich ist. In der Beratung zeigt Ihnen{" "}
          {clinic.doctor.name} dokumentierte Behandlungsverläufe, die zu Ihrer Ausgangslage
          passen, und bespricht offen, welches Ergebnis realistisch ist.
        </p>
        <div className="mt-7">
          <a href="#anfrage" className="btn btn-primary" data-cta="results-tease">
            Beratungstermin anfragen
          </a>
          <p className="mt-3 text-sm text-brand-fg-muted">
            Unverbindlich. Diskret. Antwort {clinic.responsePromise ?? "innerhalb eines Werktags"}.
          </p>
        </div>
      </div>
    </section>
  );
}
