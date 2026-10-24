import Image from "next/image";
import { practiceLegalLinks } from "@/lib/legal/practice-privacy";
import type { Clinic, Treatment } from "@/lib/types";
import { CookieSettingsButton } from "@/components/consent/cookie-consent";
import { formatAddress, telLink } from "@/lib/format";
import { PracticeStartLinks } from "./practice-start-links";

interface Props {
  clinic: Clinic;
  treatments: Treatment[];
}

/**
 * Practice start page: where the Instagram profile link and organic posts
 * land (bare domain). Neutral on purpose: the page address and title name no
 * treatment, the copy makes no promise. The visitor picks a topic and goes on
 * to that treatment page's form. Copy lives here so scripts/hwg-lint.ts scans
 * it (components/sections).
 */
export const PRACTICE_START_COPY = {
  heading: "Wofür interessieren Sie sich?",
  intro:
    "Wählen Sie das Thema, zu dem Sie eine Beratung wünschen. Auf der nächsten Seite stellen Sie Ihre Anfrage in wenigen Schritten, die Praxis meldet sich danach bei Ihnen.",
  empty: "Bitte nehmen Sie direkt Kontakt mit der Praxis auf.",
  callLabel: "Lieber anrufen?",
} as const;

export function PracticeStart({ clinic, treatments }: Props) {
  const items = treatments.map((t) => ({ urlCode: t.urlCode, label: t.h1 }));
  const legal = practiceLegalLinks(clinic);
  return (
    <>
      <header className="w-full border-b border-brand-border bg-brand-bg">
        <div className="container mx-auto flex h-16 items-center">
          {clinic.logo.endsWith(".svg") ? (
            <img src={clinic.logo} alt={clinic.logoAlt} className="h-8 w-auto md:h-9" width={180} height={36} />
          ) : (
            <Image src={clinic.logo} alt={clinic.logoAlt} width={180} height={36} className="h-8 w-auto md:h-9" priority />
          )}
        </div>
      </header>

      <main className="container mx-auto max-w-3xl py-12 md:py-16">
        <p className="text-sm text-brand-fg-muted">
          {clinic.doctor.facharzt} in {clinic.address.city}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-brand-fg md:text-4xl">{clinic.name}</h1>

        <h2 className="mt-10 text-xl font-semibold text-brand-fg md:text-2xl">{PRACTICE_START_COPY.heading}</h2>
        <p className="mt-2 text-base text-brand-fg-muted md:text-lg">{PRACTICE_START_COPY.intro}</p>

        <div className="mt-6">
          {items.length > 0 ? (
            <PracticeStartLinks clinicSlug={clinic.slug} items={items} />
          ) : (
            <p className="text-base text-brand-fg">{PRACTICE_START_COPY.empty}</p>
          )}
        </div>

        <p className="mt-8 text-base text-brand-fg-muted">
          {PRACTICE_START_COPY.callLabel}{" "}
          <a href={telLink(clinic.contact.phoneE164)} className="font-medium text-brand-fg underline underline-offset-4">
            {clinic.contact.phoneDisplay}
          </a>
        </p>
      </main>

      {/* Use the same practice-specific legal destinations as treatment pages. */}
      <footer className="border-t border-brand-border bg-brand-bg">
        <div className="container mx-auto flex flex-col gap-4 py-10 text-sm text-brand-fg-muted md:flex-row md:justify-between">
          <div>
            <div className="text-base font-semibold text-brand-fg">{clinic.name}</div>
            <div className="mt-1">{formatAddress(clinic.address)}</div>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <a href={legal.imprint} className="underline-offset-4 hover:text-brand-fg hover:underline">
              Impressum
            </a>
            <a href={legal.privacy} className="underline-offset-4 hover:text-brand-fg hover:underline">
              Datenschutz
            </a>
            <CookieSettingsButton />
          </div>
        </div>
      </footer>
    </>
  );
}
