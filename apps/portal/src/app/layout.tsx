import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const display = localFont({
  src: [
    { path: "../../public/fonts/NeueHaasDisplay-Light.woff2", weight: "300", style: "normal" },
    { path: "../../public/fonts/NeueHaasDisplay-Roman.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/NeueHaasDisplay-Mediu.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/NeueHaasDisplay-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "EINS Visuals Portal",
    template: "%s — EINS Visuals Portal",
  },
  description:
    "Kundenportal für Zahn- und Ästhetikpraxen: Anfragen, Werbebudget, Medien und Auswertungen an einem Ort.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className={display.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-bg-primary text-fg-primary antialiased">
        {children}
      </body>
    </html>
  );
}
