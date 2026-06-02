import Link from "next/link";
import { ExternalLink, MessageSquare, Star } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import {
  PATIENT_FEEDBACK_STATUSES,
  PATIENT_FEEDBACK_STATUS_LABELS,
  type PatientFeedbackStatus,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/formatting";
import { listPatientFeedback } from "@/server/queries/stimme";

export const metadata = { title: "Patientenfeedback" };

const STATUS_TONE: Record<PatientFeedbackStatus, "warn" | "neutral" | "good"> = {
  neu: "warn",
  gesehen: "neutral",
  beantwortet: "good",
  geschlossen: "neutral",
};

const PUBLIC_PLATFORM_LABEL: Record<"google" | "jameda", string> = {
  google: "Bei Google bewertet",
  jameda: "Bei Jameda bewertet",
};

export default async function PatientenfeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePermissionOrRedirect("stimme.view");
  const { status: statusParam } = await searchParams;

  const status =
    statusParam && (PATIENT_FEEDBACK_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as PatientFeedbackStatus)
      : undefined;

  const rows = await listPatientFeedback(session.clinicId, session.userId, {
    status,
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Patientenfeedback.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Alle Rückmeldungen Ihrer Patient:innen &mdash; vertrauliche Nachrichten
          und Weiterleitungen zu Google/Jameda in einer gemeinsamen Ansicht.
        </p>
      </header>

      {/* Filter chips */}
      <nav aria-label="Filter">
        <ul className="flex flex-wrap gap-2 text-sm">
          <FilterChip href="/bewertungen/feedback" active={!status}>
            Alle
          </FilterChip>
          {PATIENT_FEEDBACK_STATUSES.map((s) => (
            <FilterChip
              key={s}
              href={`/bewertungen/feedback?status=${s}`}
              active={status === s}
            >
              {PATIENT_FEEDBACK_STATUS_LABELS[s]}
            </FilterChip>
          ))}
        </ul>
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>Rückmeldungen</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<MessageSquare className="h-8 w-8" />}
                title={
                  status
                    ? "Keine Rückmeldungen in diesem Status"
                    : "Noch keine Rückmeldungen"
                }
                description={
                  status
                    ? "Wechseln Sie auf einen anderen Filter."
                    : "Sobald Patient:innen auf eine Bewertungs-Anfrage reagieren — ob vertraulich an Sie oder öffentlich bei Google/Jameda — erscheinen sie hier."
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const isPublicRedirect = r.source === "public_redirect";
                return (
                  <li key={r.id}>
                    <Link
                      href={`/bewertungen/feedback/${r.id}`}
                      className="flex flex-col gap-1 p-4 transition-colors hover:bg-bg-secondary"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className="inline-flex items-center gap-1 font-medium tabular-nums"
                          aria-label={`Bewertung ${r.rating} von 5`}
                        >
                          <Star className="h-4 w-4 fill-current" />
                          {r.rating} / 5
                        </span>
                        <Badge tone={STATUS_TONE[r.status]}>
                          {PATIENT_FEEDBACK_STATUS_LABELS[r.status]}
                        </Badge>
                        {isPublicRedirect && r.publicPlatform && (
                          <Badge tone="neutral">
                            <ExternalLink className="mr-1 h-3 w-3" />
                            {PUBLIC_PLATFORM_LABEL[r.publicPlatform]}
                          </Badge>
                        )}
                        {!isPublicRedirect && r.contactBackOk && (
                          <Badge tone="accent">Rückruf gewünscht</Badge>
                        )}
                        <span className="text-xs text-fg-tertiary tabular-nums">
                          {formatDateTime(r.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm text-fg-secondary">
                        {r.contactName ?? "Ohne Namen"}
                        {r.contactEmail && (
                          <span className="ml-2 text-fg-tertiary">{r.contactEmail}</span>
                        )}
                      </div>
                      {isPublicRedirect ? (
                        <p className="text-sm italic text-fg-tertiary">
                          Patient:in wurde zur öffentlichen Bewertung
                          weitergeleitet — kein vertraulicher Freitext.
                        </p>
                      ) : (
                        r.freeText && (
                          <p className="line-clamp-2 text-sm text-fg-primary">
                            {r.freeText}
                          </p>
                        )
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className={
          active
            ? "inline-flex items-center rounded-full bg-fg-primary px-3 py-1.5 font-medium text-bg-primary"
            : "inline-flex items-center rounded-full border border-border bg-bg-primary px-3 py-1.5 text-fg-secondary hover:bg-bg-secondary"
        }
      >
        {children}
      </Link>
    </li>
  );
}
