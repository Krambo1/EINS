/**
 * Tone vocabulary for the SegmentedShareBar, kept in a plain (non-"use client")
 * module so server components (the admin Übersicht sections) can import the
 * runtime SHARE_TONE_VAR value to colour their legends, while the client
 * SegmentedShareBar imports the same source. Importing a value from a
 * "use client" module into a server component yields a client reference, not
 * the object — hence this neutral home.
 */
// "muted" (lightest grey) keeps "Unbekannt" apart from the other neutral slices.
export type ShareTone = "neutral" | "muted" | "accent" | "good" | "warn" | "bad";

export const SHARE_TONE_VAR: Record<ShareTone, string> = {
  neutral: "var(--fg-tertiary)",
  muted: "var(--border-hover)",
  accent: "var(--accent)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
};
