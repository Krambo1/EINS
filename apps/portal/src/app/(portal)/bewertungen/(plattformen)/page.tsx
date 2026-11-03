import { cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { can } from "@/lib/roles";
import {
  bewertungenPageData,
  type ReviewSnapshot,
  type ReviewTrendRow,
} from "@/server/queries/reviews";
import {
  countNewPatientFeedback,
  listPatientFeedback,
} from "@/server/queries/patient-feedback";
import { PageHeader } from "../../_components/PageHeader";
import { PlatformTile } from "../_components/PlatformTile";
import { NewFeedbackCard } from "../_components/NewFeedbackCard";
import { ReplyTemplatesCard } from "../_components/ReplyTemplatesCard";
import { HistoryCard } from "../_components/HistoryCard";
import { TRACKED_PLATFORMS, reviewShareUrl, type Platform } from "../_lib/platforms";
import { NEW_FEEDBACK_SLOTS, TOP_FEEDBACK_SPAN, TOP_GRID } from "../_lib/sizes";
import { BewertungenSectionTabs } from "../_components/BewertungenSectionTabs";
import { mergeReplyTemplates } from "../_lib/reply-templates-store";

export const metadata = { title: "Bewertungen" };

export default async function BewertungenPage() {
  const session = await requirePermissionOrRedirect("reviews.view");

  // The sidebar counts new patient feedback on /bewertungen too, so the tab
  // shows who wrote: the count and the newest few, with the way to the
  // Patientenfeedback tab.
  const canViewPatientFeedback = can(session.role, "patient_feedback.view");

  const [clinicRows, { latest, trend, history }, newFeedbackCount, feedbackPreview] =
    await Promise.all([
      db
        .select({
          displayName: schema.clinics.displayName,
          googleReviewUrl: schema.clinics.googleReviewUrl,
          jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
          jamedaProfileUrl: schema.clinics.jamedaProfileUrl,
          replyTemplates: schema.clinics.replyTemplates,
        })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, session.clinicId))
        .limit(1),
      bewertungenPageData(session.clinicId, session.userId, 6),
      canViewPatientFeedback
        ? countNewPatientFeedback(session.clinicId, session.userId)
        : Promise.resolve(0),
      canViewPatientFeedback
        ? listPatientFeedback(session.clinicId, session.userId, { status: "neu" })
        : Promise.resolve([] as Awaited<ReturnType<typeof listPatientFeedback>>),
    ]);
  const clinic = clinicRows[0];
  // countNewPatientFeedback counts private rows only (the sidebar badge);
  // the preview follows it.
  const recentNewFeedback = feedbackPreview
    .filter((f) => f.source === "private")
    .slice(0, NEW_FEEDBACK_SLOTS);
  const reviewLinks = {
    googleReviewUrl: clinic?.googleReviewUrl ?? null,
    jamedaReviewUrl: clinic?.jamedaReviewUrl ?? null,
    jamedaProfileUrl: clinic?.jamedaProfileUrl ?? null,
  };

  const byPlatform = new Map<string, ReviewSnapshot>();
  for (const snap of latest) byPlatform.set(snap.platform, snap);

  const trendByPlatform = new Map<string, ReviewTrendRow[]>();
  for (const row of trend) {
    const arr = trendByPlatform.get(row.platform) ?? [];
    arr.push(row);
    trendByPlatform.set(row.platform, arr);
  }

  // Reviews added since the stand before the latest, per platform. The
  // history is newest first, so the first two rows of a platform are it.
  const countChangeFor = (p: Platform) => {
    const [latestRow, previous] = history.filter((r) => r.platform === p);
    if (!latestRow || !previous) return null;
    return { added: latestRow.totalCount - previous.totalCount, since: previous.recordedAt };
  };

  return (
    <>
      {/* From md the nav says where we are and the tab switch is the first
          row, level with the logo row (like the period switch on the
          Übersicht). The phone keeps the title above it. Outside the stack,
          so the hidden heading adds no spacing step. */}
      <PageHeader title="Bewertungen" className="mb-4 md:sr-only" />
      <div className="space-y-4 md:space-y-6">
        <BewertungenSectionTabs />

        <section
          aria-label="Neues Patientenfeedback und Plattformen"
          className={cn(TOP_GRID, !canViewPatientFeedback && "min-[1400px]:grid-cols-2")}
        >
          {TRACKED_PLATFORMS.map((p, i) => (
            <PlatformTile
              key={p}
              platform={p}
              snapshot={byPlatform.get(p) ?? null}
              trend={trendByPlatform.get(p) ?? []}
              countChange={countChangeFor(p)}
              shareUrl={reviewShareUrl(p, reviewLinks)}
              clinicName={clinic?.displayName ?? ""}
              reviewLinks={reviewLinks}
              className={i === 0 ? undefined : "[--delay:20ms]"}
            />
          ))}
          {/* Last, so it sits right of the platforms (Karam, 2026-10-30). */}
          {canViewPatientFeedback && (
            <NewFeedbackCard
              count={newFeedbackCount}
              rows={recentNewFeedback}
              className={cn(TOP_FEEDBACK_SPAN, "[--delay:40ms]")}
            />
          )}
        </section>

        <ReplyTemplatesCard
          praxisName={clinic?.displayName ?? null}
          templates={mergeReplyTemplates(clinic?.replyTemplates)}
          canEdit={can(session.role, "reviews.manage")}
        />

        <HistoryCard rows={history} />
      </div>
    </>
  );
}
