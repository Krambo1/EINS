import { eq } from "drizzle-orm";
import { cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatDate } from "@/lib/formatting";
import { ActionForm } from "@/app/(portal)/_components/ActionForm";
import { PendingSubmit } from "../../_components/PendingSubmit";
import { CONTROL, DashCard, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { OnboardingHead, PageNote } from "../_components/OnboardingHead";
import { StatusWord } from "../_components/StatusWord";
import { ONBOARDING_PAGE } from "../_lib/sizes";
import { DISCOVERY_BLOCKS, type DiscoveryAnswers } from "./content";
import { FragebogenForm } from "./FragebogenForm";
import { reopenDiscoveryAction } from "./actions";

export const metadata = { title: "Fragebogen zum Start" };

/**
 * Discovery-Fragebogen, Teil 1 (Vorab-Formular). Inhaber-only, like the rest
 * of /onboarding. Draft until submitted; submitted answers render read-only
 * as GOV.UK's "Check your answers", with one "Antworten anpassen" in the head.
 */
export default async function DiscoveryFragebogenPage() {
  const session = await requirePermissionOrRedirect("onboarding.complete");

  const [row] = await db
    .select()
    .from(schema.discoveryFragebogen)
    .where(eq(schema.discoveryFragebogen.clinicId, session.clinicId))
    .limit(1);

  const answers = (row?.answers ?? {}) as DiscoveryAnswers;
  const submitted = row?.status === "eingereicht";

  if (!submitted) {
    return (
      <FragebogenForm
        initialAnswers={answers}
        baseUpdatedAt={row?.updatedAt?.toISOString() ?? null}
        storageKey={`eins:fragebogen:${session.clinicId}`}
      />
    );
  }

  return (
    <div className={ONBOARDING_PAGE}>
      <OnboardingHead
        back
        title="Fragebogen"
        count={
          <ActionForm action={reopenDiscoveryAction}>
            <PendingSubmit variant="outline" className={cn(RAISED_CONTROL, CONTROL, "px-4")}>
              {/* Below lg the short word, so the title keeps its line. */}
              <span className="lg:hidden">Anpassen</span>
              <span className="hidden lg:inline">Antworten anpassen</span>
            </PendingSubmit>
          </ActionForm>
        }
      />
      <PageNote>
        <span className="flex flex-wrap items-center gap-x-2">
          <StatusWord status="erledigt" />
          {row?.submittedAt && (
            <>
              <span aria-hidden className="text-fg-secondary">
                ·
              </span>
              <span className="text-sm text-fg-secondary">Eingereicht am {formatDate(row.submittedAt)}</span>
            </>
          )}
        </span>
      </PageNote>

      {DISCOVERY_BLOCKS.map((block, i) => (
        <DashCard
          key={block.key}
          title={<span className="whitespace-normal">{block.title}</span>}
          className={i > 0 ? "[--delay:40ms]" : undefined}
          bodyClassName="pt-2"
        >
          {/* GOV.UK's summary list: the question, the answer, hairlines between. */}
          <dl className="divide-y divide-border">
            {block.questions.map((q) => {
              const value = answers[q.id];
              const text = Array.isArray(value) ? value.join(", ") : value;
              return (
                <div key={q.id} className="py-3 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6">
                  <dt className="text-sm leading-5 text-fg-secondary">{q.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-fg-primary md:mt-0">
                    {text && text.length > 0 ? text : <span className="text-fg-secondary">Keine Angabe</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </DashCard>
      ))}
    </div>
  );
}
