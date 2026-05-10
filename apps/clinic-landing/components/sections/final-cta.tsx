import type { Clinic, Treatment } from "@/lib/types";
import { telLink, whatsappLink } from "@/lib/format";

/** Section 11 — Finaler Call-to-Action. */
export function FinalCta({ clinic, treatment }: { clinic: Clinic; treatment: Treatment }) {
  return (
    <section className="bg-brand-primary text-brand-bg">
      <div className="container mx-auto max-w-3xl py-16 text-center md:py-24">
        <h2 style={{ color: "var(--brand-bg)" }}>{treatment.finalCtaPromise}</h2>
        <p className="mt-3 text-base opacity-90 md:text-lg">
          Sprechen Sie mit {clinic.doctor.name.split(" ").slice(-1)[0]} —{" "}
          {clinic.doctor.facharzt}, in {treatment.city}.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#anfrage"
            className="btn"
            style={{
              background: "var(--brand-bg)",
              color: "var(--brand-primary)",
              minHeight: 56,
              padding: "0 1.25rem",
              fontWeight: 600,
            }}
          >
            {treatment.ctaLabel ?? "Beratungstermin vereinbaren"}
          </a>
          <a
            href={telLink(clinic.contact.phoneE164)}
            className="btn"
            style={{
              background: "transparent",
              color: "var(--brand-bg)",
              border: "1px solid color-mix(in oklab, var(--brand-bg) 40%, transparent)",
              minHeight: 52,
              padding: "0 1rem",
            }}
          >
            {clinic.contact.phoneDisplay}
          </a>
          {clinic.contact.whatsappE164 && (
            <a
              href={whatsappLink(
                clinic.contact.whatsappE164,
                `Hallo, ich interessiere mich für ${treatment.h1}.`,
              )}
              className="btn"
              style={{
                background: "transparent",
                color: "var(--brand-bg)",
                border: "1px solid color-mix(in oklab, var(--brand-bg) 40%, transparent)",
                minHeight: 52,
                padding: "0 1rem",
              }}
            >
              WhatsApp
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
