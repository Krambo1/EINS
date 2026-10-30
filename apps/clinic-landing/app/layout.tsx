import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Root layout — neutral, no clinic branding.
 *
 * The actual clinic-specific layout (`app/[clinicSlug]/layout.tsx`) injects
 * brand CSS variables via inline style, mounts the consent provider, and
 * pulls in the per-clinic font stack.
 */

export const metadata: Metadata = {
  title: "Zielseiten-Vorlage",
  description:
    "Vorlage für die Zielseiten der Praxen, erreichbar über Profil-Link, Beiträge und Anzeigen. Diese Seite wird unter jeder Praxis-Domain individuell ausgespielt.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
