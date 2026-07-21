import type { Clinic, Treatment } from "@/lib/types";
import { telLink, whatsappLink } from "@/lib/format";

/**
 * Section 11 — Finaler Call-to-Action. Drei Wege: Anfrage (Anker zurück zum
 * Hero-Quiz), Anruf, WhatsApp — wer bis hierhin gelesen hat, soll nicht am
 * Kanal scheitern.
 */
export function FinalCta({ clinic, treatment }: { clinic: Clinic; treatment: Treatment }) {
  const lastName = clinic.doctor.name.split(" ").slice(-1)[0];
  return (
    <section className="section-dark">
      <div className="container mx-auto max-w-3xl py-16 text-center md:py-24">
        <h2 className="text-brand-fg">{treatment.finalCtaPromise}</h2>
        <p className="mt-3 text-base text-brand-fg-muted md:text-lg">
          Sprechen Sie mit {lastName}, {clinic.doctor.facharzt}, in {treatment.city}.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#anfrage"
            className="btn w-full sm:w-auto"
            style={{
              background: "#ffffff",
              color: "var(--brand-primary)",
              minHeight: 54,
              padding: "0 1.5rem",
              fontWeight: 600,
            }}
            data-cta="final-primary"
          >
            {treatment.ctaLabel ?? "Beratungstermin anfragen"}
          </a>
          <a
            href={telLink(clinic.contact.phoneE164)}
            className="btn btn-secondary w-full text-brand-fg sm:w-auto"
            data-cta="final-call"
          >
            {clinic.contact.phoneDisplay}
          </a>
          {clinic.contact.whatsappE164 && (
            <a
              href={whatsappLink(
                clinic.contact.whatsappE164,
                `Hallo, ich interessiere mich für ${treatment.h1}.`,
              )}
              className="btn btn-secondary w-full text-brand-fg sm:w-auto"
              data-cta="final-whatsapp"
            >
              WhatsApp
            </a>
          )}
        </div>
        <p className="mt-4 text-sm text-brand-fg-muted">
          Unverbindlich. Diskret. Antwort {clinic.responsePromise ?? "innerhalb eines Werktags"}.
        </p>
      </div>
    </section>
  );
}
