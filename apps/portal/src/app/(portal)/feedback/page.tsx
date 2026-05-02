import { desc, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Separator,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatDateTime } from "@/lib/formatting";
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
          <Separator />
          <Card>
            <CardHeader>
              <CardTitle>Bisheriges Feedback Ihrer Praxis</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
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
                      className="rounded-lg border border-border bg-bg-secondary/30 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone="accent">{categoryLabel}</Badge>
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
                        <span className="text-fg-secondary">
                          {formatDateTime(row.submittedAt)}
                        </span>
                        {row.pageUrl && (
                          <span className="text-xs text-fg-tertiary">
                            · {row.pageUrl}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-base text-fg-primary">
                        {row.message}
                      </p>
                      {row.karamNote && (
                        <p className="mt-2 rounded-md border border-border bg-bg-primary p-2 text-sm italic text-fg-secondary">
                          Antwort von EINS: {row.karamNote}
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
