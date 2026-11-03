import { cn } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { formatRelative } from "@/lib/formatting";
import { can } from "@/lib/roles";
import { ANBINDUNG_WAEHLEN, EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { CardBody, SettingsCard } from "../../../_components/settings-ui";
import { COLUMNS, LIST, LIST_ROW, ONE_LINE, STACK, slots } from "../../../_lib/sizes";
import { listOpenAgentEnrollmentsAction } from "../../actions";
import { Steps } from "../_steps";
import { GdtAgentEnroll } from "./_enroll";
import { GDT_STEPS } from "./_copy";

export const metadata = { title: "GDT-Agent" };

export default async function GdtAgentSetupPage() {
  const session = await requireSession();
  const open = await listOpenAgentEnrollmentsAction();

  return (
    <div className={STACK}>
      <SettingsHead title="GDT-Agent" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE, ANBINDUNG_WAEHLEN]} />
      <div className={COLUMNS}>
        <div className={STACK}>
          <SettingsCard id="so-gehts" title="So funktioniert es">
            <CardBody>
              <Steps>{GDT_STEPS}</Steps>
            </CardBody>
          </SettingsCard>

          <SettingsCard id="code" title="Einrichtungs-Code">
            <GdtAgentEnroll canIssue={can(session.role, "settings.integrations")} />
          </SettingsCard>

          {open.length > 0 && (
            <SettingsCard id="offene-codes" title="Offene Einrichtungs-Codes">
              <CardBody className="pt-2">
                <ul className={LIST} style={slots(3)}>
                  {open.map((e) => (
                    <li key={e.id} className={LIST_ROW}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium leading-6 text-fg-primary">
                          Läuft ab {formatRelative(e.expiresAt)}
                        </p>
                        <p className={cn(ONE_LINE, "text-sm leading-5 text-fg-secondary")}>
                          {e.expectedFingerprint ? (
                            <>
                              Nur auf <span className="font-mono">{e.expectedFingerprint}</span>
                            </>
                          ) : (
                            "Auf jedem Praxisrechner"
                          )}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
}
