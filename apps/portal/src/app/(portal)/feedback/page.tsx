import { desc, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatDate } from "@/lib/formatting";
import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/lib/constants";
import { FeedbackForm } from "./FeedbackForm";

export const metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  const session = await requirePermissionOrRedirect("feedback.submit");

  const previous = await db
    .select()
    .from(schema.feedback)
    .where(eq(schema.feedback.clinicId, session.clinicId))
    .orderBy(desc(schema.feedback.submittedAt))
    .limit(20);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Feedback.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Sagen Sie uns, was Sie sich vom Portal wünschen. Was läuft gut, was
          stört, wo hakt es. Wir lesen jede Nachricht persönlich.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Neues Feedback senden</CardTitle>
        </CardHeader>
        <CardContent>
          <FeedbackForm />
        </CardContent>
      </Card>

      {previous.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Bisheriges Feedback Ihrer Praxis</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {previous.map((row) => {
                  const categoryLabel =
                    FEEDBACK_CATEGORY_LABELS[row.category as FeedbackCategory] ??
                    row.category;
                  const statusLabel =
                    FEEDBACK_STATUS_LABELS[row.status as FeedbackStatus] ??
                    row.status;
                  return (
                    <li
                      key={row.id}
                      className="py-4 first:pt-0 last:pb-0"
                    >
                      <p className="whitespace-pre-wrap text-base text-fg-primary">
                        {row.message}
                      </p>
                      {/* Same meta line as Beiträge: status first, then the facts. */}
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
                        <Badge
                          tone={
                            row.status === "offen"
                              ? "warn"
                              : row.status === "bearbeitet"
                              ? "good"
                              : row.status === "verworfen"
                              ? "neutral"
                              : "accent"
                          }
                        >
                          {statusLabel}
                        </Badge>
                        <span>· {categoryLabel}</span>
                        <span className="tabular-nums">· {formatDate(row.submittedAt)}</span>
                        {row.pageUrl && <span>· {row.pageUrl}</span>}
                      </p>
                      {row.karamNote && (
                        <p className="mt-3 whitespace-pre-wrap border-l-2 border-border pl-4 text-sm text-fg-secondary">
                          <span className="font-medium text-fg-primary">Antwort von EINS:</span>{" "}
                          {row.karamNote}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
