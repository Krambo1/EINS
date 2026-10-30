import { redirect } from "next/navigation";

/**
 * Beiträge and Medien are one page now, Inhalte (Karam, 2026-10-29), and the
 * files sit with their posts in "Alle Beiträge" (Karam, 2026-10-30). The
 * address stays for old links, e-mails and bookmarks and opens that card.
 */
export default function MedienPage() {
  redirect("/inhalte#beitraege");
}
