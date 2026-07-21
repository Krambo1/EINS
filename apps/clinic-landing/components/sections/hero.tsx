import type { Clinic, Treatment } from "@/lib/types";
import { QuizCard } from "@/components/sections/pre-qualifier";

interface Props {
  clinic: Clinic;
  treatment: Treatment;
  privacyHref: string;
}

/**
 * Hero v2 — quiz-in-hero.
 *
 * The hero IS the conversion surface: left column carries message match
 * (H1 mirrors the ad term), trust proof in view 1 (Google stars + doctor
 * chip), the right column is the live quiz card with step 1 visible above
 * the fold. No hero image — the LCP element is text, so the page paints in
 * well under a second on 4G.
 *
 * Every CTA on the page anchors back here (`#anfrage`).
 */
export function Hero({ clinic, treatment, privacyHref }: Props) {
  const google = clinic.trust.google;

  return (
    <section id="top" className="relative overflow-hidden bg-brand-bg pb-10 pt-6 sm:pt-10 md:pb-16 md:pt-14">
      <div className="container mx-auto grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,460px)] md:gap-10 lg:gap-14">
        <div className="hero-rise md:pt-4">
          <p className="eyebrow">
            {clinic.name} · {treatment.city}
          </p>
          <h1 className="mt-3">{treatment.h1}</h1>
          <p className="mt-4 hidden max-w-xl text-base leading-relaxed text-brand-fg-muted md:block md:text-lg">
            {treatment.subline}
          </p>

          {/* Trust in view 1 — Google stars + doctor chip. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-brand-fg-muted md:mt-6">
            {google && google.count > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Stars score={google.score} />
                <span className="font-medium text-brand-fg">{google.score.toFixed(1).replace(".", ",")}</span>
                <span>· {google.count} Google-Bewertungen</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-1 w-1 rounded-full bg-brand-accent" />
              {clinic.doctor.name}, {shortFacharzt(clinic.doctor.facharzt)}
            </span>
          </div>

          {treatment.trustMicrocopy && (
            <p className="mt-3 hidden text-sm text-brand-fg-muted md:block">
              {treatment.trustMicrocopy}
            </p>
          )}
        </div>

        <div id="anfrage" className="scroll-mt-24">
          <QuizCard clinic={clinic} treatment={treatment} privacyHref={privacyHref} />
        </div>
      </div>
    </section>
  );
}

function Stars({ score }: { score: number }) {
  const full = Math.round(Math.min(score, 5));
  return (
    <span aria-hidden className="inline-flex text-brand-accent">
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={i < full ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

/** "Fachärztin für Plastische und Ästhetische Chirurgie" → "Fachärztin für Plastische Chirurgie" is lossy — just cap the length instead. */
function shortFacharzt(facharzt: string): string {
  return facharzt.length > 60 ? `${facharzt.slice(0, 57).trimEnd()} …` : facharzt;
}
