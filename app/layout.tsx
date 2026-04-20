import type { Metadata } from "next";
import localFont from "next/font/local";
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
  title: "EINS Visuals, Akquisitions-System für Zahn- & Ästhetikkliniken",
  description:
    "Mehr Patienten. Höhere Margen. Planbares Wachstum. Das komplette Akquisitions-System für Kliniken im DACH-Raum. Video, bezahlte Anzeigen und KI-gestütztes Anfrage-System als integriertes Produkt.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "EINS Visuals",
    description:
      "Akquisitions-System für Zahn- & Ästhetikkliniken im DACH-Raum.",
    url: SITE_URL,
    siteName: "EINS Visuals",
    locale: "de_DE",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "EINS Visuals" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EINS Visuals",
    description: "Akquisitions-System für Zahn- & Ästhetikkliniken im DACH-Raum.",
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
  icons: {
    icon: "/eins-mark.png",
    shortcut: "/eins-mark.png",
    apple: "/eins-mark.png",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "EINS Visuals",
  url: SITE_URL,
  logo: `${SITE_URL}/eins-logo.png`,
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
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
        >
          Zum Inhalt springen
        </a>
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
