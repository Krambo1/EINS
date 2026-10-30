/** "45 Min", "2,5 Std", "3 Tage": a span of time in the words the page uses. */
export function formatDuration(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${Math.round(min)} Min`;
  const hr = min / 60;
  if (hr < 48) return `${hr.toFixed(1).replace(".", ",")} Std`;
  const days = hr / 24;
  return `${Math.round(days)} Tage`;
}
