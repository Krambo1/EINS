import type { Treatment } from "@/lib/types";

/** Section 4 — Problem-Spiegel. Optional. Skipped if `treatment.problem` is undefined. */
export function ProblemMirror({ treatment }: { treatment: Treatment }) {
  if (!treatment.problem) return null;
  return (
    <section className="bg-brand-bg">
      <div className="container mx-auto max-w-3xl py-14 md:py-20">
        <p className="eyebrow">Sie kennen das?</p>
        <div className="mt-6 space-y-5">
          {treatment.problem.paragraphs.map((p, i) => (
            <p key={i} className="text-lg leading-relaxed text-brand-fg sm:text-xl">
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
