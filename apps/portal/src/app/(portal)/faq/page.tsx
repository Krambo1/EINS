import { requireSession } from "@/auth/guards";
import { FaqBrowser } from "./_components/FaqBrowser";

export const metadata = { title: "Hilfe" };

/**
 * Hilfe, the clinic-facing FAQ. Visible to every signed-in clinic role (no
 * extra permission gate). The page carries its OWN search (see FaqBrowser) and
 * is intentionally excluded from the global ⌘K search index.
 */
export default async function FaqPage() {
  // Gate on a valid session only: every role may read the FAQ.
  await requireSession();

  return <FaqBrowser />;
}
