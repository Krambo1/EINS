import Image from "next/image";
import type { Clinic, Treatment } from "@/lib/types";

interface Props {
  clinic: Clinic;
  treatment: Treatment;
}

/**
 * Section 2 — Hero.
 *
 * Mobile-first: image stacks below text on phones, sits beside on desktop.
 * The hero image is the LCP element: `priority`, `fetchPriority="high"`,
 * correct `sizes`. No animation libraries; CSS-only `hero-rise` slide-in.
 */
export function Hero({ clinic, treatment }: Props) {
  const ctaLabel = treatment.ctaLabel ?? "Beratungstermin vereinbaren";
  const isSvg = treatment.heroImage.src.endsWith(".svg");

  return (
    <section id="top" className="relative overflow-hidden bg-brand-bg pt-6 sm:pt-10 md:pt-14">
      <div className="container mx-auto grid items-center gap-8 md:grid-cols-2 md:gap-12 lg:gap-16">
        <div className="hero-rise">
          <p className="eyebrow">{treatment.city} · {clinic.doctor.facharzt.split(" ").slice(0, 4).join(" ")}</p>
          <h1 className="mt-3">{treatment.h1}</h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-brand-fg-muted sm:text-lg">
            {treatment.subline}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a href="#anfrage" className="btn btn-primary" data-cta="hero-primary">
              {ctaLabel}
            </a>
            <a href="#behandlung" className="btn btn-secondary" data-cta="hero-secondary">
              Mehr zur Behandlung
            </a>
          </div>
          {treatment.trustMicrocopy && (
            <p className="mt-4 text-sm text-brand-fg-muted">{treatment.trustMicrocopy}</p>
          )}
        </div>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-brand-lg bg-brand-bg-soft md:aspect-[5/4]">
          {isSvg ? (
            <img
              src={treatment.heroImage.src}
              alt={treatment.heroImage.alt}
              width={1500}
              height={1200}
              className="h-full w-full object-cover"
              fetchPriority="high"
            />
          ) : (
            <Image
              src={treatment.heroImage.src}
              alt={treatment.heroImage.alt}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              priority
              fetchPriority="high"
              className="object-cover"
            />
          )}
        </div>
      </div>
    </section>
  );
}
