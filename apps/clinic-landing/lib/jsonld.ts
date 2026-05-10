import type { Clinic, Treatment } from "./types";
import { formatPriceRange } from "./format";

/**
 * MedicalBusiness + Service + FAQPage JSON-LD per clinic landing page.
 *
 * These are validated by Google's Rich Results Test and Schema Markup Validator.
 * Don't add `Review` schema for testimonials — review-stars are restricted by
 * Google's medical-services policies and listing them invites manual penalties.
 */
export function buildJsonLd(clinic: Clinic, treatment: Treatment, pageUrl: string) {
  const apexDomain = clinic.domains[0] ?? "";
  const baseUrl = apexDomain ? `https://${apexDomain}` : pageUrl;

  const medicalBusiness = {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    "@id": `${baseUrl}#medical-business`,
    name: clinic.name,
    url: baseUrl,
    image: `${baseUrl}${clinic.logo}`,
    telephone: clinic.contact.phoneE164,
    email: clinic.contact.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: clinic.address.street,
      postalCode: clinic.address.zip,
      addressLocality: clinic.address.city,
      addressCountry: clinic.address.country,
    },
    medicalSpecialty: clinic.doctor.facharzt,
    employee: {
      "@type": "Physician",
      name: clinic.doctor.name,
      jobTitle: clinic.doctor.facharzt,
      image: `${baseUrl}${clinic.doctor.portrait}`,
    },
  };

  const service = {
    "@context": "https://schema.org",
    "@type": "MedicalProcedure",
    "@id": `${baseUrl}/${treatment.slug}#procedure`,
    name: treatment.h1,
    description: treatment.subline,
    procedureType: "https://schema.org/TherapeuticProcedure",
    bodyLocation: treatment.category,
    url: `${baseUrl}/${treatment.slug}`,
    provider: { "@id": `${baseUrl}#medical-business` },
    offers: {
      "@type": "Offer",
      priceCurrency: treatment.priceRange.currency,
      price: (treatment.priceRange.fromCents / 100).toFixed(2),
      priceSpecification: {
        "@type": "PriceSpecification",
        priceCurrency: treatment.priceRange.currency,
        price: formatPriceRange(treatment.priceRange),
      },
    },
  };

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${baseUrl}/${treatment.slug}#faq`,
    mainEntity: treatment.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return [medicalBusiness, service, faq];
}
