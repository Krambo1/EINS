import { requireSession } from "@/auth/guards";
import { getTimelineEntries } from "@/server/queries/timeline";
import { PageHeader } from "../_components/PageHeader";
import { TimelineList } from "./_components/TimelineList";
import { buildFortschritt } from "./_lib/steps";

export const metadata = { title: "Fortschritt" };

/**
 * Fortschritt: where the Praxis stands in its 90 days. The week sits in the
 * title row as plain text (Linear's project overview), then the cards In
 * Arbeit, Als Nächstes and Erledigt. Read-only for the Praxis; EINS edits
 * the steps in the admin.
 */
export default async function FortschrittPage() {
  const session = await requireSession();
  const entries = await getTimelineEntries(session.clinicId, session.userId);
  const view = buildFortschritt(entries, new Date());

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Fortschritt"
        actions={
          view.week != null && (
            <p className="text-[15px] font-medium leading-5 tabular-nums text-fg-primary">Woche {view.week}</p>
          )
        }
      />
      <TimelineList view={view} />
    </div>
  );
}
