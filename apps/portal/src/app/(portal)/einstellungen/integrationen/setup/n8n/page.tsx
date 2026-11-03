import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { ANBINDUNG_WAEHLEN, EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { CardBody, SettingsCard } from "../../../_components/settings-ui";
import { COLUMNS, STACK } from "../../../_lib/sizes";
import { Steps } from "../_steps";
import { N8nSecretReveal } from "./_reveal";
import { N8N_STEPS } from "./_copy";

export const metadata = { title: "n8n-Ablauf" };

export default async function N8nSetupPage() {
  const session = await requireSession();
  return (
    <div className={STACK}>
      <SettingsHead title="n8n-Ablauf" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE, ANBINDUNG_WAEHLEN]} />
      <div className={COLUMNS}>
        <div className={STACK}>
          <SettingsCard id="so-gehts" title="So funktioniert es">
            <CardBody>
              <Steps>{N8N_STEPS}</Steps>
            </CardBody>
          </SettingsCard>
          <SettingsCard id="schluessel" title="Zugangsdaten">
            <N8nSecretReveal clinicId={session.clinicId} canRotate={can(session.role, "settings.integrations")} />
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
