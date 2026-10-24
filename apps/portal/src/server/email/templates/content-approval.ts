/**
 * The weekly batch e-mail "Ihre Beiträge zur Freigabe" (Phase 4, D7). One
 * mail per recipient, listing the posts that person may decide, each with a
 * one-click link to /freigabe/<token>. The same buttons stand on /beitraege.
 *
 * Wording rules: nothing goes online without the Praxis' approval, a clear
 * last day, never an automatic approval.
 */

const SIGNATURE = ["Freundliche Grüße", "Ihr EINS-Team"].join("\n");

export interface ApprovalMailPost {
  title: string;
  /** Format label, e.g. "Reel". */
  format: string;
  caption: string | null;
  /** The post carries the label "KI-generiert". */
  kiLabel: boolean;
  /** The Inhaber's KI-Klon appears; only the Inhaber decides. */
  usesClone: boolean;
  url: string;
}

export interface ApprovalMailInput {
  recipientName: string | null;
  practiceName: string;
  /** "Mittwoch, 14.10.2026" (formatApprovalDue). */
  dueLabel: string;
  /** "14.10.2026", for the subject. */
  dueDate: string;
  posts: ApprovalMailPost[];
  /** Absolute URL of /beitraege. */
  portalUrl: string;
  linkTtlDays: number;
}

export function approvalBatchMail(input: ApprovalMailInput): { subject: string; text: string } {
  const n = input.posts.length;
  const greeting = input.recipientName?.trim() ? `Guten Tag ${input.recipientName.trim()},` : "Guten Tag,";
  const intro =
    n === 1
      ? `EINS hat einen neuen Beitrag für ${input.practiceName} vorbereitet.`
      : `EINS hat ${n} neue Beiträge für ${input.practiceName} vorbereitet.`;

  const blocks = input.posts.map((p, i) => {
    const lines = [`${i + 1}. ${p.title} (${p.format})`];
    if (p.caption?.trim()) lines.push("Beitragstext:", p.caption.trim());
    if (p.kiLabel) lines.push("Hinweis: Der Beitrag ist als „KI-generiert“ gekennzeichnet.");
    if (p.usesClone) {
      lines.push("In diesem Beitrag erscheint Ihr KI-Klon. Diesen Beitrag gibt nur die Inhaberin oder der Inhaber frei.");
    }
    lines.push(`Ansehen und entscheiden: ${p.url}`);
    return lines.join("\n");
  });

  return {
    subject: `Ihre Beiträge zur Freigabe bis ${input.dueDate}`,
    text: [
      greeting,
      "",
      `${intro} Ohne Ihre Freigabe geht kein Beitrag online.`,
      "",
      `Bitte geben Sie ${n === 1 ? "den Beitrag" : "jeden Beitrag"} bis ${input.dueLabel} frei oder beschreiben Sie, was wir ändern sollen. Das geht über den Link beim Beitrag oder im Portal unter Beiträge. Es gilt die erste Entscheidung.`,
      "",
      ...blocks.flatMap((b) => [b, ""]),
      `Die Links gelten ${input.linkTtlDays} Tage. Danach entscheiden Sie im Portal unter Beiträge: ${input.portalUrl}`,
      "",
      "Wenn Sie Fragen haben, antworten Sie einfach auf diese E-Mail.",
      "",
      SIGNATURE,
    ].join("\n"),
  };
}
