/**
 * Words shared by server and client parts of the Einstellungen pages. They
 * live in a plain module: a server component that imports a value from a
 * "use client" file gets a client reference, not the value, and renders
 * nothing (the read-only "Abstand je Behandlung" rows were empty that way).
 */

/** The heading of the jump list, in the rail, the 390 menu and the skeleton. */
export const TOC_LABEL = "Auf dieser Seite";

/** The three choices of "Abstand je Behandlung", in the select and as read-only text. */
export const INTERVAL_MODE_LABELS = {
  auto: "Automatisch",
  fixed: "Fester Abstand",
  off: "Nicht im Kalender",
} as const;
