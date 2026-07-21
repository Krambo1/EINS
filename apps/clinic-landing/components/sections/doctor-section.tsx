import Image from "next/image";
import type { Clinic } from "@/lib/types";

/**
 * Section 4 — the authority block, MOVED UP before the long persuasion path.
 *
 * Renders as the page's single dark "anchor": `.section-dark` swaps the
 * foreground tokens locally (white text on the primary fill), resetting
 * attention two-thirds of the way into a scroll. 92 % of patients read the
 * physician profile before inquiring — this block answers "wer behandelt
 * mich?" before anything asks for trust.
 *
 * The continuity promise is the quiet counter to Behandlungsketten and
 * Ausland-OPs — stated as a service fact, never as Angstwerbung (§ 11 HWG).
 */
export function DoctorSection({ clinic }: { clinic: Clinic }) {
  const isSvg = clinic.doctor.portrait.endsWith(".svg");
  return (
    <section className="section-dark">
      <div className="container mx-auto py-16 md:py-24">
        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-12 lg:gap-16">
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-brand-lg bg-black/10">
            {isSvg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clinic.doctor.portrait}
                alt={clinic.doctor.portraitAlt}
                width={1200}
                height={1500}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <Image
                src={clinic.doctor.portrait}
                alt={clinic.doctor.portraitAlt}
                fill
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-cover"
              />
            )}
          </div>
          <div>
            <p className="eyebrow">02 · Wer Sie behandelt</p>
            <h2 className="mt-3 text-brand-fg">{clinic.doctor.name}</h2>
            <p className="mt-2 text-brand-fg-muted">{clinic.doctor.facharzt}</p>

            {clinic.doctor.quote && (
              <blockquote className="mt-6 border-l-2 border-brand-accent pl-4 font-display text-xl leading-snug text-brand-fg md:text-2xl">
                „{clinic.doctor.quote}"
              </blockquote>
            )}

            <ul className="mt-6 space-y-3 text-brand-fg-muted">
              {clinic.doctor.cv.map((line, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brand-accent" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {clinic.doctor.memberships && clinic.doctor.memberships.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {clinic.doctor.memberships.map((m) => (
                  <span
                    key={m}
                    className="rounded-brand-pill border border-brand-border px-3 py-1 text-xs font-medium text-brand-fg-muted"
                  >
                    {m}
                  </span>
                ))}
              </div>
            )}

            {/* Continuity promise — Beratung, Behandlung, Nachsorge in einer Hand. */}
            <div className="mt-8 rounded-brand border border-brand-border p-4">
              <p className="text-sm font-semibold text-brand-fg">Eine Hand, ein Weg</p>
              <p className="mt-1 text-sm leading-relaxed text-brand-fg-muted">
                Beratung, Behandlung und jede Nachsorge bei {clinic.doctor.name} persönlich.
                Auch Monate später erreichen Sie {clinic.doctor.name} direkt, nicht ein
                wechselndes Team.
              </p>
            </div>
          </div>
        </div>

        {clinic.practiceImages && clinic.practiceImages.length > 0 && (
          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {clinic.practiceImages.slice(0, 3).map((img, i) => (
              <div key={i} className="relative aspect-[4/3] overflow-hidden rounded-brand bg-black/10">
                {img.src.endsWith(".svg") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.src} alt={img.alt} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Image
                    src={img.src}
                    alt={img.alt}
                    fill
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="object-cover"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
