import { cn } from "@eins/ui";
import { Brand } from "@/app/_components/Brand";
import { DashCard, WASH_AREA, WASH_ROW } from "../../../dashboard/_components/dash-ui";
import { SettingsHead, WERBEKONTEN } from "../../_components/SettingsHead";
import { CardBody, CardFoot } from "../../_components/settings-ui";
import { COLUMNS, SKELETON_BAR, STACK } from "../../_lib/sizes";

const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";

/**
 * The Facebook page list before Facebook has answered: the same head, card,
 * two rows as the picker builds them (radio, name, Seiten-ID) and the foot.
 * The page exists for the account with several pages, so that is the state
 * it holds the place of; a one-sentence state arrives shorter.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="Facebook-Seite wählen" trail={[WERBEKONTEN]} />
      <div className={COLUMNS}>
        <DashCard
          title={<Brand brand="meta">Meta · Facebook &amp; Instagram</Brand>}
          bodyClassName="p-0 md:p-0"
        >
          <CardBody className="space-y-3 pt-2">
            <ul className="divide-y divide-border">
              {["w-48", "w-36"].map((w) => (
                <li key={w} className={WASH_ROW}>
                  <span className={cn(WASH_AREA, "flex items-start gap-3 py-3")}>
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[var(--well)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex h-6 items-center">
                        <span className={cn(SKELETON_BAR, "h-4 max-w-full", w)} />
                      </span>
                      <span className="flex h-5 items-center">
                        <span className={cn(SKELETON_BAR, "h-3.5 w-40 max-w-full")} />
                      </span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
          <CardFoot>
            <span className={cn(BUTTON_SLOT, "w-[11.75rem]")} />
          </CardFoot>
        </DashCard>
      </div>
    </div>
  );
}
