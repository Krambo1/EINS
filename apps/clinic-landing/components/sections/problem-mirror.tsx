import type { Treatment } from "@/lib/types";

/** Section 3 — Problem-Spiegel. Optional; warm traffic scrolls past, cold traffic feels seen. */
export function ProblemMirror({ treatment }: { treatment: Treatment }) {
  if (!treatment.problem) return null;
  return (
    <section className="bg-brand-bg">
      <div className="container mx-auto max-w-3xl py-16 md:py-24">
        <p className="eyebrow">01 · Ihr Anliegen</p>
        <div className="mt-6 space-y-5">
          {treatment.problem.paragraphs.map((p, i) => (
            <p
              key={i}
              className={
                i === 0
                  ? "font-display text-xl leading-relaxed text-brand-fg sm:text-2xl"
                  : "text-lg leading-relaxed text-brand-fg-muted sm:text-xl"
              }
            >
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
