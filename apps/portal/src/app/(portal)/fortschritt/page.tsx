import { requireSession } from "@/auth/guards";
import { getTimelineEntries } from "@/server/queries/timeline";
import { TimelineList } from "./_components/TimelineList";

export const metadata = { title: "Fortschritt" };

export default async function FortschrittPage() {
  const session = await requireSession();
  const entries = await getTimelineEntries(session.clinicId, session.userId);

  return (
    <div className="space-y-8">
      <header data-tour="fortschritt-header">
        <h1 className="text-3xl font-semibold md:text-4xl">Fortschritt.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Was wir gerade für Sie tun und was als Nächstes ansteht.
        </p>
      </header>

      <TimelineList entries={entries} />
    </div>
  );
}
