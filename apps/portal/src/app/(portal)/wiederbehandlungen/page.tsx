import { redirect } from "next/navigation";

/**
 * Wiederbehandlungen live on the Anfragen page (Karam, 2026-10-29): due ones
 * among the call cards, all of them as the list filter "Wiederbehandlung".
 * The address stays for old links and bookmarks and opens that filter.
 */
export default function WiederbehandlungenPage() {
  redirect("/anfragen?wb=offen");
}
