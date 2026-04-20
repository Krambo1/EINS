import type { ReactNode } from "react";

/**
 * Minimal inline emphasis parser for copy strings.
 *
 * Syntax:
 *   **text**   → bold (semibold)
 *   [[text]]   → accent color + medium weight
 *   *text*     → italic
 *
 * Non-nesting. Order-agnostic. Safe on plain strings (returns input unchanged).
 */
export function md(input: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[\[([^\]]+)\]\]|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(input)) !== null) {
    if (m.index > last) parts.push(input.slice(last, m.index));
    if (m[1] !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold text-fg-primary">
          {m[1]}
        </strong>
      );
    } else if (m[2] !== undefined) {
      parts.push(
        <span key={key++} className="font-medium text-accent">
          {m[2]}
        </span>
      );
    } else if (m[3] !== undefined) {
      parts.push(<em key={key++}>{m[3]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < input.length) parts.push(input.slice(last));
  return parts.length ? parts : input;
}
