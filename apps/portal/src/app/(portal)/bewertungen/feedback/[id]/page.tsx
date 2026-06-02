import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Mail,
  PhoneCall,
  Star,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import {
  PATIENT_FEEDBACK_STATUSES,
  PATIENT_FEEDBACK_STATUS_LABELS,
  type PatientFeedbackStatus,
} from "@/lib/constants";
import { can } from "@/lib/roles";
import { formatDateTime } from "@/lib/formatting";
import {
  getPatientFeedback,
  markPatientFeedbackSeen,
} from "@/server/queries/patient-feedback";
import { setFeedbackStatusAction } from "../actions";
import { FeedbackReplyEditor } from "./_reply-editor";

export const metadata = { title: "Patientenfeedback — Rückmeldung" };

const STATUS_TONE: Record<PatientFeedbackStatus, "warn" | "neutral" | "good"> = {
  neu: "warn",
  gesehen: "neutral",
  beantwortet: "good",
  geschlossen: "neutral",
};

const PUBLIC_PLATFORM_LABEL: Record<"google" | "jameda", string> = {
  google: "Google",
  jameda: "Jameda",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PatientenfeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermissionOrRedirect("patient_feedback.view");
  const { id } = await params;

  if (!UUID_RE.test(id)) notFound();

  const feedback = await getPatientFeedback(
    session.clinicId,
    session.userId,
    id
  );
  if (!feedback) notFound();

  // First time anyone opens this private feedback, flip neu → gesehen so
  // the sidebar Bewertungen badge drops on next navigation. Idempotent on
  // re-opens. The (portal) layout is dynamic (re-runs per navigation via
  // requireSession), so no revalidate is needed — the badge re-counts
  // automatically the next time the sidebar renders.
  if (feedback.status === "neu" && feedback.source === "private") {
    await markPatientFeedbackSeen(session.clinicId, session.userId, id);
    feedback.status = "gesehen";
  }

  const canManage = can(session.role, "patient_feedback.manage");
  const isPublicRedirect = feedback.source === "public_redirect";
  const platformLabel =
    isPublicRedirect && feedback.publicPlatform
      ? PUBLIC_PLATFORM_LABEL[feedback.publicPlatform]
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/bewertungen/feedback"
          className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zum Postfach
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="inline-flex items-center gap-2 text-3xl font-semibold md:text-4xl">
              <Star className="h-7 w-7 fill-current" />
              {feedback.rating} / 5
            </h1>
            <Badge tone={STATUS_TONE[feedback.status]}>
              {PATIENT_FEEDBACK_STATUS_LABELS[feedback.status]}
            </Badge>
            {platformLabel && (
              <Badge tone="neutral">
                <ExternalLink className="mr-1 h-3 w-3" />
                Bei {platformLabel} bewertet
              </Badge>
            )}
            {!isPublicRedirect && feedback.contactBackOk && (
              <Badge tone="accent">Rückruf gewünscht</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-fg-secondary">
            Eingegangen {formatDateTime(feedback.createdAt)}
            {feedback.reviewRequestScheduledFor && (
              <> · Anstoß: Termin am {feedback.reviewRequestScheduledFor}</>
            )}
            {feedback.reviewRequestTreatmentLabel && (
              <> · Anlass: {feedback.reviewRequestTreatmentLabel}</>
            )}
          </p>
        </div>
      </header>

      {/* Public-redirect: no free-text body, no contact card. The patient
          went to Google/Jameda; they never filled in the private form, so
          there is no consented contact data to act on here. The actual
          public review will surface via the platform-sync workers. */}
      {isPublicRedirect ? (
        <Card>
          <CardHeader>
            <CardTitle>Weiterleitung zur öffentlichen Bewertung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-fg-primary">
              Patient:in hat die Bewertungs-Anfrage geöffnet und sich für eine
              öffentliche Bewertung bei{" "}
              <span className="font-medium">{platformLabel}</span> entschieden.
            </p>
            <p className="text-fg-secondary">
              Es liegt kein vertraulicher Freitext und keine Einwilligung zur
              Kontaktaufnahme vor &mdash; die eigentliche Bewertung erscheint
              automatisch bei {platformLabel}, sobald sie veröffentlicht wurde.
            </p>
            {(feedback.contactName || feedback.contactEmail) && (
              <p className="rounded-lg bg-bg-secondary px-3 py-2 text-fg-secondary">
                Zuordnung (intern):{" "}
                <span className="font-medium text-fg-primary">
                  {feedback.contactName ?? "Ohne Namen"}
                </span>
                {feedback.contactEmail && (
                  <span className="ml-1 text-fg-tertiary">
                    &middot; {feedback.contactEmail}
                  </span>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Free-text body */}
          <Card>
            <CardHeader>
              <CardTitle>Rückmeldung</CardTitle>
            </CardHeader>
            <CardContent>
              {feedback.freeText ? (
                <blockquote className="whitespace-pre-wrap border-l-4 border-fg-primary/30 pl-4 text-base leading-relaxed text-fg-primary">
                  {feedback.freeText}
                </blockquote>
              ) : (
                <p className="text-sm italic text-fg-tertiary">
                  Patient:in hat keinen Freitext hinterlassen — nur die
                  Stern-Bewertung.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardHeader>
              <CardTitle>Kontakt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-fg-secondary">Name:</span>{" "}
                <span className="font-medium text-fg-primary">
                  {feedback.contactName ?? "Nicht angegeben"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-fg-secondary">E-Mail:</span>
                {feedback.contactEmail ? (
                  <a
                    href={`mailto:${feedback.contactEmail}`}
                    className="inline-flex items-center gap-1 text-fg-primary underline underline-offset-4"
                  >
                    <Mail className="h-4 w-4" />
                    {feedback.contactEmail}
                  </a>
                ) : (
                  <span className="text-fg-tertiary">Nicht angegeben</span>
                )}
              </div>
              {feedback.contactBackOk ? (
                <div className="space-y-3">
                  <p className="inline-flex items-center gap-2 rounded-lg bg-bg-secondary px-3 py-2 text-fg-primary">
                    <PhoneCall className="h-4 w-4" />
                    Patient:in erlaubt aktiv die Kontaktaufnahme zu dieser
                    Rückmeldung.
                  </p>
                  {feedback.contactEmail && (
                    <div>
                      <a
                        href={`mailto:${feedback.contactEmail}?subject=${encodeURIComponent(
                          "Ihre Rückmeldung an unsere Praxis"
                        )}&body=${encodeURIComponent(
                          `Guten Tag${
                            feedback.contactName ? ` ${feedback.contactName}` : ""
                          },\n\nvielen Dank, dass Sie sich die Zeit für Ihre Rückmeldung genommen haben. Ihr Anliegen ist uns wichtig, und wir möchten gerne darauf eingehen.\n\nMit freundlichen Grüßen\nIhr Praxis-Team`
                        )}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm font-medium text-fg-primary hover:bg-bg-secondary"
                      >
                        <Mail className="h-4 w-4" />
                        Per E-Mail antworten
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-lg bg-bg-secondary px-3 py-2 text-fg-secondary">
                  Kein Rückrufwunsch &mdash; bitte ungefragt nicht kontaktieren.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Triage actions */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Bearbeiten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-fg-primary">
                Status setzen
              </p>
              <div className="flex flex-wrap gap-2">
                {PATIENT_FEEDBACK_STATUSES.map((s) => (
                  <form key={s} action={setFeedbackStatusAction}>
                    <input type="hidden" name="id" value={feedback.id} />
                    <input type="hidden" name="status" value={s} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={feedback.status === s ? "default" : "outline"}
                      disabled={feedback.status === s}
                    >
                      {PATIENT_FEEDBACK_STATUS_LABELS[s]}
                    </Button>
                  </form>
                ))}
              </div>
            </div>

            <FeedbackReplyEditor
              feedbackId={feedback.id}
              rating={feedback.rating ?? null}
              defaultNote={feedback.internalNote ?? ""}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
