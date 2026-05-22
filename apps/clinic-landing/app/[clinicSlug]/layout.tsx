import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ConsentProvider } from "@/components/consent/consent-context";
import { CookieConsent } from "@/components/consent/cookie-consent";
import {
  getClinic,
  isHiddenClinicSlug,
  listClinics,
} from "@/lib/clinic-registry";
import { clinicMetadata } from "@/lib/seo";
import { hexToRgb, radiusToCss } from "@/lib/format";
import type { Clinic } from "@/lib/types";

interface LayoutProps {
  children: ReactNode;
  params: { clinicSlug: string };
}

export function generateStaticParams() {
  return listClinics()
    .filter((c) => !isHiddenClinicSlug(c.slug))
    .map((c) => ({ clinicSlug: c.slug }));
}

export function generateMetadata({ params }: { params: { clinicSlug: string } }) {
  if (isHiddenClinicSlug(params.clinicSlug)) return {};
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) return {};
  return clinicMetadata(clinic);
}

export default function ClinicLayout({ children, params }: LayoutProps) {
  if (isHiddenClinicSlug(params.clinicSlug)) notFound();
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) notFound();

  const cssVars = buildCssVars(clinic);
  const fontFaceCss = buildFontFaceCss(clinic);

  return (
    <ConsentProvider>
      {fontFaceCss && (
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: fontFaceCss }}
        />
      )}
      {clinic.brand.googleFontsUrl && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={clinic.brand.googleFontsUrl} />
        </>
      )}
      <div
        // The CSS variables here override the neutral defaults in globals.css
        // and cascade to every section.
        style={cssVars}
        className="min-h-screen bg-brand-bg text-brand-fg"
      >
        {children}
        <CookieConsent privacyHref={`/${clinic.slug}/datenschutz`} />
      </div>
    </ConsentProvider>
  );
}

function buildCssVars(clinic: Clinic): React.CSSProperties {
  const b = clinic.brand;
  return {
    ["--brand-primary" as any]: b.primary,
    ["--brand-primary-soft" as any]: b.primarySoft,
    ["--brand-accent" as any]: b.accent,
    ["--brand-bg" as any]: b.bg,
    ["--brand-bg-soft" as any]: b.bgSoft,
    ["--brand-fg" as any]: b.fg,
    ["--brand-fg-muted" as any]: b.fgMuted,
    ["--brand-border" as any]: b.border,
    ["--brand-radius" as any]: radiusToCss(b.radius),
    ["--brand-font" as any]: b.fontFamily,
  } as React.CSSProperties;
}

function buildFontFaceCss(clinic: Clinic): string | null {
  const fonts = clinic.brand.fonts;
  if (!fonts || fonts.length === 0) return null;
  return fonts
    .map((f) => {
      const src = `/clinics/${clinic.slug}/fonts/${f.filename}`;
      return `@font-face { font-family: '${f.family}'; src: url('${src}') format('woff2'); font-weight: ${f.weight}; font-style: ${f.style ?? "normal"}; font-display: ${f.display ?? "swap"}; }`;
    })
    .join("\n");
}

// Validate that the rgb helper compiles — it's used in a future server-only computation.
void hexToRgb;
