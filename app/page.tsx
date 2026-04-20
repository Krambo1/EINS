import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/sections/hero";
import { StatsShowcase } from "@/components/sections/stats-showcase";
import { System } from "@/components/sections/system";
import { Offer } from "@/components/sections/offer";
import { Roi } from "@/components/sections/roi";
import { Guarantee } from "@/components/sections/guarantee";
import { Timeline } from "@/components/sections/timeline";
import { FitCheck } from "@/components/sections/fit-check";
import { Objections } from "@/components/sections/objections";
import { FinalCta } from "@/components/sections/final-cta";
import { OBJECTIONS } from "@/lib/objections-data";

const SITE_URL = "https://einsvisuals.com";

const localBusinessJsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "EINS Visuals",
  url: SITE_URL,
  image: `${SITE_URL}/eins-logo.png`,
  description:
    "Akquisitions-System für Zahn- & Ästhetikkliniken im DACH-Raum. Medienproduktion, bezahlte Anzeigen und KI-gestütztes Anfrage-System.",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Köln",
    addressCountry: "DE",
  },
  areaServed: ["DE", "AT", "CH"],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: OBJECTIONS.map((o) => ({
    "@type": "Question",
    name: o.q,
    acceptedAnswer: { "@type": "Answer", text: o.a },
  })),
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg-primary">
        <div className="absolute inset-x-0 -top-40 transform-gpu overflow-hidden blur-3xl sm:-top-80">
          <div
            style={{
              clipPath:
                "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
              background: "linear-gradient(to top right, #58BAB5, #64CEC9)",
            }}
            className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] max-w-none -translate-x-1/2 rotate-[30deg] opacity-30 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
          />
        </div>
        <div className="absolute inset-x-0 top-[calc(100%-13rem)] transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]">
          <div
            style={{
              clipPath:
                "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
              background: "linear-gradient(to top right, #58BAB5, #64CEC9)",
            }}
            className="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] max-w-none -translate-x-1/2 opacity-30 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]"
          />
        </div>
      </div>
      <Nav />
      <main>
        <Hero />
        <System />
        <Roi />
        <Offer />
        <StatsShowcase />
        <Guarantee />
        <Timeline />
        <FitCheck />
        <Objections />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
