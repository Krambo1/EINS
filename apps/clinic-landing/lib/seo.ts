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
    title: treatment.seo.metaTitle,
    description: treatment.seo.metaDescription,
    alternates: { canonical: `/${treatment.slug}` },
    openGraph: {
      title: treatment.seo.metaTitle,
      description: treatment.seo.metaDescription,
      siteName: clinic.name,
      locale: "de_DE",
      type: "website",
      images: treatment.seo.ogImage
        ? [{ url: treatment.seo.ogImage, width: 1200, height: 630 }]
        : [{ url: `/${treatment.slug}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: treatment.seo.metaTitle,
      description: treatment.seo.metaDescription,
    },
  };
}
