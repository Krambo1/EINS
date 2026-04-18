import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

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

const sans = localFont({
  src: [
    { path: "../public/fonts/NeueHaasDisplay-Light.woff2",  weight: "300", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Roman.woff2",  weight: "400", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Mediu.woff2",  weight: "500", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Bold.woff2",   weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

const mono = localFont({
  src: [
    { path: "../public/fonts/NeueHaasDisplay-Light.woff2",  weight: "300", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Roman.woff2",  weight: "400", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Mediu.woff2",  weight: "500", style: "normal" },
    { path: "../public/fonts/NeueHaasDisplay-Bold.woff2",   weight: "700", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://einsvisuals.com"),
  title: "EINS Visuals, Premium Akquisitions-System für Zahn- & Ästhetikkliniken",
  description:
    "Mehr Patienten. Höhere Margen. Planbares Wachstum. Das komplette Akquisitions-System für Kliniken im DACH-Raum. Video, Paid Ads und KI-gestützte Lead-Infrastruktur als integriertes Produkt.",
  openGraph: {
    title: "EINS Visuals",
    description:
      "Premium Akquisitions-System für Zahn- & Ästhetikkliniken im DACH-Raum.",
    locale: "de_DE",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de-DE" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {/* Unified fixed page background: two clipped gradient shapes in EINS yellow. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg-primary">
          {/* Top-right clipped gradient shape */}
          <div className="absolute inset-x-0 -top-40 transform-gpu overflow-hidden blur-3xl sm:-top-80">
            <div
              style={{
                clipPath:
                  "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
                background: "linear-gradient(to top right, #d4d943, #eef08a)",
              }}
              className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] max-w-none -translate-x-1/2 rotate-[30deg] opacity-30 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
            />
          </div>
          {/* Bottom-left clipped gradient shape */}
          <div className="absolute inset-x-0 top-[calc(100%-13rem)] transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]">
            <div
              style={{
                clipPath:
                  "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
                background: "linear-gradient(to top right, #d4d943, #eef08a)",
              }}
              className="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] max-w-none -translate-x-1/2 opacity-30 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]"
            />
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
