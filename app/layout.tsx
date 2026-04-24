import type { Metadata } from "next";
import localFont from "next/font/local";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/constants";

const display = localFont({
  src: [
    { path: "../public/fonts/NeueHaasDisplay-Light.woff2",  weight: "300", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Roman.woff2",  weight: "400", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Mediu.woff2",  weight: "500", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Bold.woff2",   weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const SITE_URL = "https://einsvisuals.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "EINS Visuals | Akquise-System für Ästhetikkliniken",
    template: "%s | EINS Visuals",
  },
  description:
    "Mehr Selbstzahler für Ihre Ästhetikklinik: Video, bezahlte Anzeigen und KI-gestütztes Anfrage-System als integriertes Akquise-System im DACH-Raum.",
  applicationName: "EINS Visuals",
  keywords: [
    "Ästhetikklinik Marketing",
    "Patientenakquise",
    "Selbstzahler gewinnen",
    "Klinik Werbung",
    "Medizin Video Produktion",
    "Meta Ads Klinik",
    "EINS Visuals",
  ],
  authors: [{ name: "EINS Visuals", url: SITE_URL }],
  creator: "EINS Visuals",
  publisher: "EINS Visuals",
  alternates: { canonical: "/" },
  openGraph: {
    title: "EINS Visuals | Akquise-System für Ästhetikkliniken",
    description:
      "Mehr Selbstzahler für Ihre Ästhetikklinik: Video, bezahlte Anzeigen und KI-gestütztes Anfrage-System. DACH-Raum.",
    url: SITE_URL,
    siteName: "EINS Visuals",
    locale: "de_DE",
    type: "website",
    images: [{ url: "/eins-logo.png", width: 1200, height: 630, alt: "EINS Visuals" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EINS Visuals | Akquise-System für Ästhetikkliniken",
    description: "Mehr Selbstzahler für Ihre Ästhetikklinik. Video, bezahlte Anzeigen, KI-Anfrage-System.",
    images: ["/eins-logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/eins-mark.png", type: "image/png", sizes: "any" },
    ],
    shortcut: "/eins-mark.png",
    apple: "/eins-mark.png",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "EINS Visuals",
  alternateName: "EINS",
  url: SITE_URL,
  logo: `${SITE_URL}/eins-logo.png`,
  image: `${SITE_URL}/eins-logo.png`,
  description:
    "Akquise-System für Ästhetikkliniken im DACH-Raum. Video, bezahlte Anzeigen und KI-gestütztes Anfrage-System als integriertes Produkt.",
  slogan: "Mehr Selbstzahler. Mehr Umsatz. Mehr Sicherheit.",
  email: CONTACT_EMAIL,
  telephone: CONTACT_PHONE,
  address: {
    "@type": "PostalAddress",
    addressLocality: "Köln",
    addressCountry: "DE",
  },
  areaServed: ["DE", "AT", "CH"],
  sameAs: [],
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "EINS Visuals",
  url: SITE_URL,
  inLanguage: "de-DE",
  publisher: { "@type": "Organization", name: "EINS Visuals" },
};

const serviceJsonLd = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: "EINS Visuals",
  url: SITE_URL,
  image: `${SITE_URL}/eins-logo.png`,
  description:
    "Akquise-System für Ästhetikkliniken: Medienproduktion, bezahlte Anzeigen und KI-gestütztes Anfrage-System.",
  areaServed: [
    { "@type": "Country", name: "Deutschland" },
    { "@type": "Country", name: "Österreich" },
    { "@type": "Country", name: "Schweiz" },
  ],
  serviceType: [
    "Patientenakquise",
    "Medienproduktion für Kliniken",
    "Bezahlte Anzeigen",
    "KI-gestütztes Anfrage-System",
  ],
  priceRange: "€€€",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className={display.variable}>
      <head>
        <link rel="preconnect" href="https://calendly.com" />
        <link rel="dns-prefetch" href="https://calendly.com" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }}
        />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
        >
          Zum Inhalt springen
        </a>
        <div id="main-content">{children}</div>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
