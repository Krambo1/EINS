import { ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import { DashCard, WASH_AREA, WASH_ROW } from "../../../dashboard/_components/dash-ui";
import { SettingsHead } from "../../_components/SettingsHead";
import { CardBody, Status } from "../../_components/settings-ui";
import { COLUMNS, LINK_ROW, SKELETON_BAR, STACK } from "../../_lib/sizes";

const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";

/**
 * Praxis-Software before it arrives: the same head and "Verbindung" card,
 * the vendor row's name and status as grey bars, its button as a slot, the
 * link row with its words. The incident card is added below when there are
 * any. In the route group with its page so it does not also wrap the pages
 * below Praxis-Software (they have their own).
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="Praxis-Software" />
      <div className={COLUMNS}>
        <DashCard title="Verbindung" bodyClassName="p-0 md:p-0">
          <CardBody className="pt-2">
            <ul className="divide-y divide-border">
              <li className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex h-6 items-center">
                    <span className={cn(SKELETON_BAR, "h-4 w-40")} />
                  </div>
                  <div className="mt-1 flex min-h-6 items-center">
                    <Status tone="none">
                      <span className={cn(SKELETON_BAR, "h-3.5 w-28")} />
                    </Status>
                  </div>
                </div>
                <div className="flex w-full gap-2 lg:w-auto">
                  <span className={cn(BUTTON_SLOT, "w-[11.5rem]")} />
                </div>
              </li>
              <li className={WASH_ROW}>
                <span className={cn(LINK_ROW, WASH_AREA, "text-[15px] font-medium text-fg-primary")}>
                  <span className="min-w-0 flex-1">Nicht zuordenbare Patienten</span>
                  <Status tone="none" className="shrink-0 font-normal">
                    <span className={cn(SKELETON_BAR, "h-3.5 w-16")} />
                  </Status>
                  <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden />
                </span>
              </li>
            </ul>
          </CardBody>
        </DashCard>
      </div>
    </div>
  );
}
