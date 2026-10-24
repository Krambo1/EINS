/**
 * Short Berlin-time deadline for lists and cards (DS3 item 3):
 * "Mo., 12.10., 13:00 Uhr". The weekday helps more than the year here.
 */
const shortFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDeadlineShort(ts: Date | null | undefined): string {
  if (!ts || Number.isNaN(ts.getTime())) return "–";
  return `${shortFormatter.format(ts)} Uhr`;
}
