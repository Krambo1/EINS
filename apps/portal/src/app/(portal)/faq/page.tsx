import { requireSession } from "@/auth/guards";
import { FaqBrowser } from "./_components/FaqBrowser";
import { FAQ_TOTAL_QUESTIONS } from "./content";

export const metadata = { title: "Häufige Fragen" };

/**
 * Clinic-facing FAQ. Visible to every signed-in clinic role (no extra
 * permission gate). The page carries its OWN search (see FaqBrowser) and is
 * intentionally excluded from the global ⌘K search index.
 */
export default async function FaqPage() {
  // Gate on a valid session only — every role may read the FAQ.
  await requireSession();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Häufige Fragen.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Antworten auf {FAQ_TOTAL_QUESTIONS} häufige Fragen rund um Ihr Portal
          und die Zusammenarbeit mit EINS. Durchsuchen Sie die Liste, oder
          öffnen Sie eine Frage für die Antwort.
        </p>
      </header>

      <FaqBrowser />
    </div>
  );
}
