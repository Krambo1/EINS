import { requirePermissionOrRedirect } from "@/auth/guards";
import {
  countPatientFeedbackByStatus,
  listPatientFeedback,
} from "@/server/queries/patient-feedback";
import { PageHeader } from "../../../_components/PageHeader";
import { BewertungenSectionTabs } from "../../_components/BewertungenSectionTabs";
import { feedbackQueryFilter, parseFeedbackFilter, viewCounts } from "../../_lib/feedback-filter";
import { FeedbackList } from "../_components/FeedbackList";

export const metadata = { title: "Patientenfeedback" };

/** The row cap of listPatientFeedback. */
const FEEDBACK_LIST_CAP = 200;

export default async function PatientenfeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermissionOrRedirect("patient_feedback.view");
  const sp = await searchParams;
  const filter = parseFeedbackFilter((k) => {
    const v = sp[k];
    return typeof v === "string" ? v : undefined;
  });

  // Every row once, so the views, the stars, the search and the pager
  // switch in the browser (FeedbackList). Only a list at the query's row
  // cap is filtered and counted on the server.
  const all = await listPatientFeedback(session.clinicId, session.userId);
  const instant = all.length < FEEDBACK_LIST_CAP;
  const { statuses, ...bandAndSearch } = feedbackQueryFilter(filter);
  const [rows, byStatus] = instant
    ? [all, null]
    : await Promise.all([
        listPatientFeedback(session.clinicId, session.userId, { statuses, ...bandAndSearch }),
        countPatientFeedbackByStatus(session.clinicId, session.userId, bandAndSearch),
      ]);

  return (
    <>
      {/* As on the Plattformen tab: from md the tab switch is the first row. */}
      <PageHeader title="Bewertungen" className="mb-4 md:sr-only" />
      <div className="space-y-4 md:space-y-6">
        <BewertungenSectionTabs />
        <FeedbackList
          instant={instant}
          serverCounts={byStatus ? viewCounts(byStatus) : null}
          rows={rows.map((r) => ({
            id: r.id,
            rating: r.rating,
            status: r.status,
            source: r.source,
            publicPlatform: r.publicPlatform,
            contactBackOk: r.contactBackOk,
            contactName: r.contactName,
            contactEmail: r.contactEmail,
            freeText: r.freeText,
            createdAt: r.createdAt,
          }))}
        />
      </div>
    </>
  );
}
