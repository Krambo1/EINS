import Image from "next/image";
import type { Clinic, Treatment } from "@/lib/types";
import { telLink, whatsappLink } from "@/lib/format";

interface Props {
  clinic: Clinic;
  treatment: Treatment;
}

/**
 * Mobile-first sticky top nav.
 * - Logo left, "Anrufen" + "Termin" right
 * - 64px tall on mobile so tap targets meet HIG
 * - No hamburger — there's nowhere to navigate; this is a single-page funnel
 */
export function StickyNav({ clinic, treatment }: Props) {
  const ctaLabel = treatment.ctaLabel ?? "Beratungstermin vereinbaren";
  return (
    <header className="sticky top-0 z-40 w-full border-b border-brand-border bg-brand-bg/95 backdrop-blur supports-[backdrop-filter]:bg-brand-bg/85">
      <div className="container mx-auto flex h-16 items-center justify-between gap-3">
        <a href="#top" aria-label={`Zur Startseite ${clinic.name}`} className="flex items-center">
          {clinic.logo.endsWith(".svg") ? (
            // SVGs render best as <img> for arbitrary aspect ratios
            <img
              src={clinic.logo}
              alt={clinic.logoAlt}
              className="h-8 w-auto md:h-9"
              width={180}
              height={36}
            />
          ) : (
            <Image
              src={clinic.logo}
              alt={clinic.logoAlt}
              width={180}
              height={36}
              className="h-8 w-auto md:h-9"
              priority
            />
          )}
        </a>
        <div className="flex items-center gap-1.5">
          <a
            href={telLink(clinic.contact.phoneE164)}
            className="hidden h-11 items-center gap-1.5 rounded-brand px-3 text-sm font-medium text-brand-fg transition-colors hover:text-brand-primary sm:inline-flex"
            aria-label="Praxis anrufen"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="hidden md:inline">{clinic.contact.phoneDisplay}</span>
            <span className="md:hidden">Anrufen</span>
          </a>
          <a
            href="#anfrage"
            className="btn btn-primary inline-flex h-11 min-h-0 items-center px-3 text-sm sm:px-4"
          >
            <span className="sm:hidden">Termin</span>
            <span className="hidden sm:inline">{ctaLabel}</span>
          </a>
          {clinic.contact.whatsappE164 && (
            <a
              href={whatsappLink(
                clinic.contact.whatsappE164,
                `Hallo, ich interessiere mich für ${treatment.h1}.`,
              )}
              className="ml-1 hidden h-11 w-11 items-center justify-center rounded-brand text-brand-fg transition-colors hover:text-brand-primary sm:inline-flex"
              aria-label="WhatsApp Nachricht schreiben"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12a11.94 11.94 0 0 0 1.71 6.16L0 24l5.95-1.55A12 12 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.18-3.48-8.52zM12 21.94a9.94 9.94 0 0 1-5.07-1.39l-.36-.21-3.53.92.94-3.44-.23-.36a9.94 9.94 0 0 1-1.52-5.46c0-5.49 4.46-9.95 9.95-9.95 2.65 0 5.15 1.04 7.04 2.92a9.86 9.86 0 0 1 2.91 7.04c0 5.49-4.46 9.93-9.95 9.93zm5.45-7.45c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.93 1.17-.17.2-.34.22-.64.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.79-1.67-2.09-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.59-.9-2.18-.24-.57-.48-.49-.66-.5-.17-.01-.37-.01-.57-.01-.2 0-.51.07-.78.37-.27.3-1.02 1-1.02 2.43s1.05 2.82 1.2 3.02c.15.2 2.07 3.17 5.02 4.45.7.3 1.25.48 1.68.62.71.22 1.35.19 1.86.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z"/>
              </svg>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
