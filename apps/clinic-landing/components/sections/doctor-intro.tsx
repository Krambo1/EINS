import Image from "next/image";
import type { Clinic } from "@/lib/types";

/** Section 7 — Ärztin / Praxis-Vorstellung. */
export function DoctorIntro({ clinic }: { clinic: Clinic }) {
  const isSvg = clinic.doctor.portrait.endsWith(".svg");
  return (
    <section className="bg-brand-bg">
      <div className="container mx-auto py-14 md:py-20">
        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-12 lg:gap-16">
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-brand-lg bg-brand-bg-soft">
            {isSvg ? (
              <img
                src={clinic.doctor.portrait}
                alt={clinic.doctor.portraitAlt}
                width={1200}
                height={1500}
                className="h-full w-full object-cover"
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
            <p className="eyebrow">Ihre Ärztin</p>
            <h2 className="mt-3">{clinic.doctor.name}</h2>
            <p className="mt-2 text-brand-fg-muted">{clinic.doctor.facharzt}</p>
            <ul className="mt-6 space-y-3 text-brand-fg-muted">
              {clinic.doctor.cv.map((line, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brand-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {clinic.doctor.memberships && clinic.doctor.memberships.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {clinic.doctor.memberships.map((m) => (
                  <span
                    key={m}
                    className="rounded-brand-pill border border-brand-border bg-brand-bg-soft px-3 py-1 text-xs font-medium text-brand-fg-muted"
                  >
                    {m}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {clinic.practiceImages && clinic.practiceImages.length > 0 && (
          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {clinic.practiceImages.slice(0, 3).map((img, i) => (
              <div key={i} className="relative aspect-[4/3] overflow-hidden rounded-brand bg-brand-bg-soft">
                {img.src.endsWith(".svg") ? (
                  <img src={img.src} alt={img.alt} className="h-full w-full object-cover" />
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
