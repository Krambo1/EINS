/**
 * Tone vocabulary for the SegmentedShareBar, kept in a plain (non-"use client")
 * module so server components (the admin Übersicht sections) can import the
 * runtime SHARE_TONE_VAR value to colour their legends, while the client
 * SegmentedShareBar imports the same source. Importing a value from a
 * "use client" module into a server component yields a client reference, not
 * the object — hence this neutral home.
 */
export type ShareTone = "neutral" | "accent" | "good" | "warn" | "bad";

export const SHARE_TONE_VAR: Record<ShareTone, string> = {
  neutral: "var(--fg-tertiary)",
  accent: "var(--accent)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
};
