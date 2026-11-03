import { requireSession } from "@/auth/guards";
import { EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { COLUMNS, STACK } from "../../../_lib/sizes";
import { SetupOptions } from "../_options";

export const metadata = { title: "Anbindung wählen" };

/**
 * How the Praxis-Software reaches the portal: a CSV file, the GDT agent on a
 * Praxis computer, or an n8n flow. Each row leads to its own page.
 */
export default async function IntegrationenSetupPage() {
  await requireSession();

  return (
    <div className={STACK}>
      <SettingsHead title="Anbindung wählen" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE]} />
      <div className={COLUMNS}>
        <SetupOptions />
      </div>
    </div>
  );
}
