import { EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { COLUMNS, STACK } from "../../../_lib/sizes";
import { SetupOptions } from "../_options";

/**
 * Nothing to load on this page: the skeleton is the page. In the route group
 * with its page so it does not also wrap CSV, GDT and n8n.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <SettingsHead title="Anbindung wählen" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE]} />
      <div className={COLUMNS}>
        <SetupOptions />
      </div>
    </div>
  );
}
