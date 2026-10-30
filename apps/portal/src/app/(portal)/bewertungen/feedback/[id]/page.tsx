import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, ExternalLink, Info, Mail, PhoneCall } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { can } from "@/lib/roles";
import { formatDate, formatDateTime, formatNumber } from "@/lib/formatting";
import { isUuid } from "@/lib/ids";
import { BrandLogo } from "@/app/_components/Brand";
import {
  getPatientFeedback,
  getPatientFeedbackResolution,
  listPatientFeedback,
  markPatientFeedbackSeen,
} from "@/server/queries/patient-feedback";
import { CONTROL, DashCard, QUIET_CONTROL, RAISED_CONTROL } from "../../../dashboard/_components/dash-ui";
import { CenteredNote, FeedbackStars, FeedbackStatus, PLATFORM_NAME, feedbackName } from "../../_components/feedback-ui";
import { publicProfileUrl } from "../../_lib/platforms";
import { feedbackFilterQuery, feedbackQueryFilter, parseFeedbackFilter } from "../../_lib/feedback-filter";
import { DETAIL_GRID, DETAIL_TEXT_HEIGHT, FACT_COLUMNS, RECORD_NAME_HEIGHT } from "../../_lib/sizes";
import { FeedbackNav } from "./_nav";
import { FeedbackStatusSwitch } from "./_status-switch";
import { FeedbackReplyEditor } from "./_reply-editor";
import { CopyEmailButton } from "./_copy-email";
import { ScrollHint } from "@/app/_components/ScrollHint";

export const metadata = { title: "Patientenfeedback: Rückmeldung" };

const CARD =
  "anim-rise elev-card lift min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6";

/** The name steps down with its length, so it fits the record's name block. */
function recordNameSize(name: string): string {
  const n = name.length;
  if (n <= 28) return "text-2xl leading-8";
  if (n <= 52) return "text-xl leading-6";
  return "text-base leading-6";
}

/**
 * One Rückmeldung as a record (Attio's record page): on the phone the
 * record comes first, with the one thing to do (answer by e-mail, or open
 * the platform) at its top; from xl it is the column on the right (Linear's
 * and Zendesk's details sidebar) beside the patient's text and the work on
 * it. The header row holds the way back and "3 von 12" with the arrows to
 * the neighbouring entries of the list the person came from (Gmail,
 * Zendesk). Every card keeps one height: the text and the note scroll
 * inside their wells, and saving shows as a toast.
 */
export default async function PatientenfeedbackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermissionOrRedirect("patient_feedback.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  if (!isUuid(id)) notFound();

  // The list filter the person came from rides along (?status=, ?sterne=,
  // ?suche=), so the arrows and the way back stay in that list. Opened from
  // elsewhere, the arrows go through all Rückmeldungen.
  const filter = parseFeedbackFilter((k) => {
    const v = sp[k];
    return typeof v === "string" ? v : undefined;
  }, "alle");
  const qs = feedbackFilterQuery(filter);

  // The list is read before the entry is marked as seen, so a "Neu" list
  // still holds it.
  const [feedback, list, resolution, clinicRows] = await Promise.all([
    getPatientFeedback(session.clinicId, session.userId, id),
    listPatientFeedback(session.clinicId, session.userId, feedbackQueryFilter(filter)),
    getPatientFeedbackResolution(session.clinicId, session.userId, id),
    db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1),
  ]);
  if (!feedback) notFound();
  const praxisName = clinicRows[0]?.displayName?.trim() || null;

  // First time anyone opens this private feedback, flip neu → gesehen so
  // the sidebar Bewertungen badge drops on next navigation. Idempotent on
  // re-opens. The (portal) layout is dynamic (re-runs per navigation via
  // requireSession), so no revalidate is needed — the badge re-counts
  // automatically the next time the sidebar renders.
  if (feedback.status === "neu" && feedback.source === "private") {
    await markPatientFeedbackSeen(session.clinicId, session.userId, id);
    feedback.status = "gesehen";
  }

  const index = list.findIndex((r) => r.id === id);
  const hrefFor = (r: (typeof list)[number] | undefined) => (r ? `/bewertungen/feedback/${r.id}${qs}` : null);
  const prevHref = index > 0 ? hrefFor(list[index - 1]) : null;
  const nextHref = index >= 0 ? hrefFor(list[index + 1]) : null;

  const canManage = can(session.role, "patient_feedback.manage");
  const isPublicRedirect = feedback.source === "public_redirect";
  const platform = isPublicRedirect ? feedback.publicPlatform : null;
  const platformLabel = platform ? PLATFORM_NAME[platform] : null;
  const name = feedbackName(feedback.contactName);
  const email = feedback.contactEmail?.trim() || null;
  const wantsContact = !isPublicRedirect && feedback.contactBackOk;
  const resolved = feedback.status === "beantwortet" || feedback.status === "geschlossen";

  const signature = !praxisName
    ? "Ihr Praxis-Team"
    : /^praxis\b/i.test(praxisName)
      ? `Ihr Team der ${praxisName}`
      : `Ihr Team der Praxis ${praxisName}`;
  const mailto =
    wantsContact && email
      ? `mailto:${email}?subject=${encodeURIComponent("Ihre Rückmeldung an unsere Praxis")}&body=${encodeURIComponent(
          `Guten Tag${feedback.contactName?.trim() ? ` ${feedback.contactName.trim()}` : ""},\n\nvielen Dank, dass Sie sich die Zeit für Ihre Rückmeldung genommen haben. Ihr Anliegen ist uns wichtig, und wir möchten gerne darauf eingehen.\n\nMit freundlichen Grüßen\n${signature}`
        )}`
      : null;
  const platformUrl = platform && praxisName ? publicProfileUrl(platform, praxisName) : null;

  const anlass = feedback.reviewRequestTreatmentLabel
    ? `${feedback.reviewRequestTreatmentLabel}${feedback.reviewRequestScheduledFor ? `, Termin am ${formatDate(feedback.reviewRequestScheduledFor)}` : ""}`
    : feedback.reviewRequestScheduledFor
      ? `Termin am ${formatDate(feedback.reviewRequestScheduledFor)}`
      : null;

  return (
    <>
      <div className="mb-4 flex h-[var(--track-h)] items-center justify-between gap-3 md:mb-6">
        <Link href={`/bewertungen/feedback${qs}`} className={cn(QUIET_CONTROL, "-ml-2.5")}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Alle Rückmeldungen
        </Link>
        <FeedbackNav
          position={index >= 0 ? index + 1 : null}
          total={list.length}
          prevHref={prevHref}
          nextHref={nextHref}
        />
      </div>

      <div className={DETAIL_GRID}>
        <section
          aria-label="Angaben zur Rückmeldung"
          className={cn(CARD, "[--delay:20ms] xl:col-start-2 xl:row-span-2 xl:row-start-1")}
        >
          <div className={cn("scroll-shadows flex [--scroll-bg:var(--surface-tile)]", RECORD_NAME_HEIGHT)}>
            <h1 className={cn("mt-auto min-w-0 break-words font-semibold text-fg-primary", recordNameSize(name))}>
              {name}
            </h1>
          </div>
          <div className="mt-2 flex h-6 items-center gap-2">
            <FeedbackStars rating={feedback.rating} size={18} />
            <span aria-hidden className="text-sm tabular-nums text-fg-secondary">
              {formatNumber(feedback.rating)} von 5
            </span>
          </div>

          {/* flex: an inline-flex button in a block adds a line box (3 px). */}
          <div className="mt-4 flex">
            {mailto ? (
              <Button asChild className={cn(CONTROL, "w-full")}>
                <a href={mailto}>
                  <Mail className="h-4 w-4" aria-hidden />
                  Per E-Mail antworten
                </a>
              </Button>
            ) : platformUrl ? (
              <Button asChild variant="outline" className={cn(RAISED_CONTROL, CONTROL, "w-full")}>
                <a href={platformUrl} target="_blank" rel="noopener noreferrer">
                  Bei {platformLabel} ansehen
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              </Button>
            ) : (
              <p className="flex h-[var(--control-h)] w-full items-center gap-2 text-sm leading-5 text-fg-secondary">
                <Info className="h-4 w-4 shrink-0" aria-hidden />
                {isPublicRedirect
                  ? "Öffentlich bewertet, ohne privaten Kontakt."
                  : wantsContact
                    ? "Rückruf gewünscht, aber ohne E-Mail-Adresse."
                    : "Kein Rückrufwunsch: bitte nicht ungefragt anschreiben."}
              </p>
            )}
          </div>

          <dl className="mt-4 divide-y divide-border border-t border-border [--scroll-bg:var(--surface-tile)]">
            <Fact label="Status">
              <FeedbackStatus status={feedback.status} className="flex h-5 text-[15px]" />
            </Fact>
            <Fact label="Erledigt" lines={2}>
              {/* Always two lines, so saving a status never grows the card. */}
              <span className="block">
                {!resolved
                  ? "Noch offen"
                  : resolution.resolvedAt
                    ? formatDate(resolution.resolvedAt)
                    : "Ohne Datum erfasst"}
              </span>
              <span className="block min-h-5 text-sm text-fg-secondary">
                {resolved && resolution.resolvedByName ? `von ${resolution.resolvedByName}` : ""}
              </span>
            </Fact>
            <Fact label="Eingang">
              <span className="tabular-nums">{formatDateTime(feedback.createdAt)}</span>
            </Fact>
            <Fact label="Anlass">{anlass ?? <span className="text-fg-secondary">Nicht hinterlegt</span>}</Fact>
            {/* The address scrolls on its own, so the copy button stays put and unclipped. */}
            <Fact label="E-Mail" scroll={false}>
              {email ? (
                <span className="flex items-start justify-between gap-2">
                  <span className="scroll-shadows-x min-w-0 flex-1">{email}</span>
                  {wantsContact && <CopyEmailButton email={email} />}
                </span>
              ) : (
                <span className="text-fg-secondary">Nicht angegeben</span>
              )}
            </Fact>
            <Fact label="Rückruf">
              {wantsContact ? (
                <span className="flex h-5 items-center gap-1.5">
                  <PhoneCall className="h-4 w-4 text-tone-warn" aria-hidden />
                  Gewünscht
                </span>
              ) : (
                <span className="text-fg-secondary">Nicht gewünscht</span>
              )}
            </Fact>
            <Fact label="Weg">
              {isPublicRedirect ? (
                <span className="flex h-5 items-center gap-1.5">
                  {platform && <BrandLogo brand={platform} className="h-4 w-4" />}
                  Weiter zu {platformLabel ?? "einer Plattform"}
                </span>
              ) : (
                "Privates Formular"
              )}
            </Fact>
          </dl>
        </section>

        <DashCard title="Rückmeldung" className="[--delay:40ms] xl:col-start-1 xl:row-start-1">
          <ScrollHint>
            <div
              role="region"
              aria-label="Text der Rückmeldung"
              tabIndex={0}
              className={cn(
                "scroll-shadows elev-inset rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                DETAIL_TEXT_HEIGHT,
                !isPublicRedirect && !feedback.freeText && "flex"
              )}
            >
              {isPublicRedirect ? (
                <>
                  <p>Weitergeleitet zu {platformLabel ?? "einer Plattform"}: Die Bewertung steht dort öffentlich, nicht hier.</p>
                  <p className="mt-2 text-fg-secondary">
                    Es gibt deshalb keinen privaten Text und keine Einwilligung zur Kontaktaufnahme. Die Bewertung selbst sehen
                    Sie bei {platformLabel ?? "der Plattform"}, sobald sie veröffentlicht ist.
                  </p>
                </>
              ) : feedback.freeText ? (
                <p className="whitespace-pre-wrap break-words">{feedback.freeText}</p>
              ) : (
                <CenteredNote title="Ohne Text." text="Hier wurden nur Sterne vergeben." />
              )}
            </div>
          </ScrollHint>
        </DashCard>

        {canManage && (
          <DashCard title="Bearbeiten" className="[--delay:60ms] xl:col-start-1 xl:row-start-2">
            <p className="mb-2 text-sm font-medium leading-5 text-fg-primary">Status</p>
            <FeedbackStatusSwitch feedbackId={feedback.id} status={feedback.status} />
            <div className="mt-5">
              <FeedbackReplyEditor
                feedbackId={feedback.id}
                rating={feedback.rating}
                defaultNote={feedback.internalNote ?? ""}
                praxisName={praxisName}
              />
            </div>
          </DashCard>
        )}
      </div>
    </>
  );
}

/**
 * One fact of the record: label left, value right (Attio's record details).
 * The value has a fixed height and never wraps, so a long e-mail or Anlass
 * keeps every row at its height (and the skeleton's): it scrolls sideways
 * instead of being cut with "…". Icon rows use flex, not inline-flex, which
 * would add a line box of 1 to 3 px.
 */
function Fact({
  label,
  lines = 1,
  scroll = true,
  children,
}: {
  label: string;
  lines?: 1 | 2;
  scroll?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-h-11 items-start gap-3 py-3", FACT_COLUMNS)}>
      <dt className="text-sm leading-5 text-fg-secondary">{label}</dt>
      <dd
        className={cn(
          "min-w-0 whitespace-nowrap text-[15px] leading-5 text-fg-primary",
          lines === 2 ? "h-10" : "h-5",
          scroll && "scroll-shadows-x"
        )}
      >
        {children}
      </dd>
    </div>
  );
}
