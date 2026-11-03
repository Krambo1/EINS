import { Button, cn } from "@eins/ui";
import { CONTROL, DashCard, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { OnboardingHead, PageNote } from "../_components/OnboardingHead";
import { SectionRail } from "../_components/SectionRail";
import { COLUMNS, ONBOARDING_PAGE, SKELETON_BAR, SUBMIT_BUTTONS, SUBMIT_ROW } from "../_lib/sizes";
import { DISCOVERY_BLOCKS, DISCOVERY_ESTIMATE_NOTE } from "./content";
import { sectionAnchorId } from "./anchors";
import { QuestionField, SectionCard } from "./QuestionField";

/**
 * Same frame as the form: the questions are fixed text, so the skeleton draws
 * them as they are, empty and disabled; only the counts and status words are
 * bars. Nothing moves when the answers arrive.
 */
export default function Loading() {
  return (
    <div className={ONBOARDING_PAGE} aria-busy="true" aria-live="polite">
      <OnboardingHead back title="Fragebogen" count={<span className={cn(SKELETON_BAR, "block h-4 w-32")} />} />
      <PageNote>{DISCOVERY_ESTIMATE_NOTE}</PageNote>
      <div className={COLUMNS}>
        <div className="space-y-4 md:space-y-6">
          {DISCOVERY_BLOCKS.map((block) => (
            <SectionCard key={block.key} block={block} status={<span className={cn(SKELETON_BAR, "block h-4 w-14")} />}>
              {block.questions.map((q) => (
                <QuestionField key={q.id} question={q} />
              ))}
            </SectionCard>
          ))}
          <DashCard bodyClassName="pt-5 md:pt-6">
            <div className={SUBMIT_ROW}>
              <div className="min-w-0">
                <p className="flex h-6 items-center">
                  <span className={cn(SKELETON_BAR, "h-4 w-56 max-w-full")} />
                </p>
                <p className="mt-0.5 text-sm leading-5 text-fg-secondary">
                  Nach dem Einreichen können Sie Ihre Antworten weiterhin anpassen.
                </p>
              </div>
              <div className={SUBMIT_BUTTONS}>
                <Button disabled className={cn(CONTROL, "px-4")}>
                  Antworten einreichen
                </Button>
                <Button disabled variant="outline" className={cn(RAISED_CONTROL, CONTROL, "px-4")}>
                  Zwischenspeichern
                </Button>
              </div>
            </div>
          </DashCard>
        </div>
        <SectionRail
          skeleton
          active={sectionAnchorId(DISCOVERY_BLOCKS[0]!.key)}
          entries={DISCOVERY_BLOCKS.map((b) => ({ id: sectionAnchorId(b.key), title: b.title, status: "offen" }))}
        />
      </div>
    </div>
  );
}
