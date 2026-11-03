import { cn } from "@eins/ui";
import { WASH_ROW } from "../../dashboard/_components/dash-ui";
import { OnboardingHead, PageNote } from "../_components/OnboardingHead";
import { SectionRail } from "../_components/SectionRail";
import { COLUMNS, ITEM_ROW, ONBOARDING_PAGE, SKELETON_BAR } from "../_lib/sizes";
import { CHECKLIST_BLOCKS } from "./content";
import { AbschlussCard, BlockCard, ItemRowContent, MesswegeCard, blockAnchorId } from "./parts";

/**
 * Same frame as the page: the blocks and their items are fixed text, so the
 * skeleton draws them as they are, all closed; only the counts, the status
 * words and the Messwege are bars. Nothing moves when the items arrive.
 */
export default function Loading() {
  return (
    <div className={ONBOARDING_PAGE} aria-busy="true" aria-live="polite">
      <OnboardingHead back title="Checkliste" count={<span className={cn(SKELETON_BAR, "block h-4 w-32")} />} />
      <PageNote>Bitte geben Sie niemals Passwörter weiter, wir fragen auch nie danach.</PageNote>
      <div className={COLUMNS}>
        <div className="space-y-4 md:space-y-6">
          {CHECKLIST_BLOCKS.map((block) => (
            <BlockCard key={block.key} block={block} status={<span className={cn(SKELETON_BAR, "block h-4 w-14")} />}>
              {block.items.map((item) => (
                <li key={item.id} className={WASH_ROW}>
                  <div className={cn(ITEM_ROW, "hover:bg-transparent")}>
                    <ItemRowContent item={item} meta={null} />
                  </div>
                </li>
              ))}
            </BlockCard>
          ))}
          <AbschlussCard />
          <MesswegeCard rows={null} />
        </div>
        <SectionRail
          skeleton
          active={blockAnchorId(CHECKLIST_BLOCKS[0]!.key)}
          entries={CHECKLIST_BLOCKS.map((b) => ({ id: blockAnchorId(b.key), title: b.title, status: "offen" }))}
        />
      </div>
    </div>
  );
}
