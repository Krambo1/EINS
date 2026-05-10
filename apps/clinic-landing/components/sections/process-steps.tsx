import type { Treatment } from "@/lib/types";

/** Section 9 — So läuft es bei Ihnen ab. */
export function ProcessSteps({ treatment }: { treatment: Treatment }) {
  return (
    <section className="bg-brand-bg">
      <div className="container mx-auto py-14 md:py-20">
        <p className="eyebrow">Ihr Weg</p>
        <h2 className="mt-3">So läuft es bei Ihnen ab</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {treatment.process.steps.map((s) => (
            <li
              key={s.index}
              className="card flex flex-col"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-primary-soft font-semibold text-brand-primary">
                {s.index}
              </div>
              <h3 className="mt-4 text-base font-semibold text-brand-fg">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-fg-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
