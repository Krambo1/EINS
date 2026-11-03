/** The fixed texts of the GDT-Agent page, shared with `loading.tsx`. */

export const GDT_STEPS = [
  <>
    Sie erzeugen unten einen einmaligen <strong className="font-semibold">Einrichtungs-Code</strong> (24 Stunden
    gültig).
  </>,
  "In Ihrer Praxis laden Sie den Installer (Windows MSI oder Mac DMG) herunter und starten ihn mit dem Code.",
  "Der Agent verbindet sich, erhält einen eigenen geheimen Schlüssel und überwacht den GDT-Ordner Ihrer Praxis-Software.",
  "Richten Sie in Ihrer Praxis-Software einen GDT-Partner mit dem Ziel-Ordner des Agents ein. Termine, Behandlungen und Rechnungen fließen dann automatisch ins Portal.",
];

export const FINGERPRINT_HINT =
  "Mit dem Namen funktioniert der Code nur auf genau diesem Gerät. Das schützt gegen Code-Diebstahl.";

export const ONCE =
  "Der Code wird nur einmal angezeigt. Bei Verlust einfach einen neuen erzeugen.";

/** In the empty well for roles without `settings.integrations` (the action refuses them). */
export const OWNER_ONLY = "Nur die Rolle Inhaber kann einen Code erzeugen.";

/**
 * Height of the code well in every state: padding, two lines at control
 * height (code, install command), the gap between them and the closing
 * sentence.
 */
export const CODE_WELL = "h-[calc(2*var(--control-h)+3.75rem)]";
