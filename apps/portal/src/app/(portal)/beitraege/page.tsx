import { redirect } from "next/navigation";

/**
 * Beiträge and Medien are one page now, Inhalte (Karam, 2026-10-29). The
 * address stays for old links, e-mails and bookmarks and opens it.
 */
export default function BeitraegePage() {
  redirect("/inhalte");
}
