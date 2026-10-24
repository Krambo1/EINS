import type { Metadata } from "next";
import type { Clinic, Treatment } from "./types";

export function clinicMetadata(clinic: Clinic): Metadata {
  return {
    metadataBase: new URL(`https://${clinic.domains[0] ?? "clinic-landing.vercel.app"}`),
    title: { default: clinic.name, template: `%s | ${clinic.name}` },
    description: `${clinic.name} – ${clinic.doctor.facharzt} in ${clinic.address.city}.`,
    applicationName: clinic.name,
    authors: [{ name: clinic.doctor.name }],
    creator: clinic.name,
    publisher: clinic.name,
    icons: {
      icon: clinic.logo,
      shortcut: clinic.logo,
      apple: clinic.logo,
    },
    robots: { index: true, follow: true },
    formatDetection: {
      telephone: false,
      address: false,
      email: false,
    },
  };
}

export function treatmentMetadata(clinic: Clinic, treatment: Treatment): Metadata {
  return {
    // Neutral tab title: gtag and the TikTok pixel send document.title with
    // every page view, so it must not name the treatment. og/twitter titles
    // (link previews) keep the treatment.
    title: "Beratungsanfrage",
    description: treatment.seo.metaDescription,
    // Neutral urlCode, never the slug: pixels send the page address.
    alternates: { canonical: `/${treatment.urlCode}` },
    openGraph: {
      title: treatment.seo.metaTitle,
      description: treatment.seo.metaDescription,
      siteName: clinic.name,
      locale: "de_DE",
      type: "website",
      images: treatment.seo.ogImage
        ? [{ url: treatment.seo.ogImage, width: 1200, height: 630 }]
        : [{ url: `/${treatment.urlCode}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: treatment.seo.metaTitle,
      description: treatment.seo.metaDescription,
    },
  };
}

/**
 * Practice start page (bare domain, `/<clinicSlug>` on internal hosts).
 * Pixels send the page address and title, so neither names a treatment: the
 * title is the practice name only, link previews use the same neutral text.
 * scripts/validate-clinics.ts checks this against every treatment word.
 */
export function practiceStartMetadata(clinic: Clinic): Metadata {
  const description = `${clinic.name}, ${clinic.doctor.facharzt} in ${clinic.address.city}. Beratungsanfrage online.`;
  return {
    title: { absolute: clinic.name },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title: clinic.name,
      description,
      siteName: clinic.name,
      locale: "de_DE",
      type: "website",
    },
    twitter: { card: "summary", title: clinic.name, description },
  };
}
