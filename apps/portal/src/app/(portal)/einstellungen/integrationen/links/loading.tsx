import { cn } from "@eins/ui";
import { DashCard } from "../../../dashboard/_components/dash-ui";
import { EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../_components/SettingsHead";
import { CardBody } from "../../_components/settings-ui";
import { COLUMNS, SKELETON_BAR, STACK } from "../../_lib/sizes";
import { NOTHING_OPEN } from "./_copy";

/**
 * Before the list arrives: the card of the common case, nothing open, its
 * sentence as grey bars that wrap exactly like the text will.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="Nicht zuordenbare Patienten" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE]} />
      <div className={COLUMNS}>
        <DashCard bodyClassName="p-0 md:p-0">
          <CardBody className="pt-5 md:pt-6">
            <p className="text-[15px] leading-6 text-transparent">
              <span className={cn(SKELETON_BAR, "box-decoration-clone")}>{NOTHING_OPEN}</span>
            </p>
          </CardBody>
        </DashCard>
      </div>
    </div>
  );
}
