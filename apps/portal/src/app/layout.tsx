import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppEffects } from "./_components/AppEffects";

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
    default: "EINS Portal",
    template: "%s — EINS Portal",
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
      <head>
        {/* Set data-theme BEFORE first paint so CSS-variable surfaces don't
            flash white→dark on reload. Runs synchronously in <head>; the
            try/catch covers privacy modes where localStorage throws. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('eins-portal-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-dvh bg-bg-primary text-fg-primary antialiased">
        <AppEffects />
        {children}
      </body>
    </html>
  );
}
