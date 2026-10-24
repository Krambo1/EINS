import Link from "next/link";
import {
  Card,
  Badge,
  StatusPill,
  Button,
  ExplainerPopover,
} from "@eins/ui";
import {
  AlarmClock,
  ArrowRight,
  MessageCircle,
  Mail,
  Phone,
} from "lucide-react";
import { SOURCE_LABELS } from "@/lib/constants";
import { formatRelative } from "@/lib/formatting";
import type { CallQueueLead } from "@/server/queries/requests";
import { CallOutcomeActions } from "./CallOutcomeActions";
import { TimingLine } from "./TimingLine";
import { quizAnswerLines } from "../_lib/quiz-answers";
import { AI_SCORE_EXPLANATION, aiCategoryWord, aiScoreText } from "../_lib/ai-score";
import { rowTiming } from "../_lib/row-timing";

/**
 * Call-Center-Header für die Anfragen-Seite. Wird für jede Rolle mit
 * `requests.update` gerendert (C-20): in kleinen Praxen ruft die Inhaberin
 * selbst zurück, ihre fälligen Wiedervorlagen müssen hier auftauchen.
 *
 * Layout-Logik:
 *  - Großes Hero-Card = "Jetzt anrufen" für den priorisiertesten Lead
 *    (volle Patient-Nachricht + große Action-Buttons).
 *  - Schmaler Stack daneben/darunter = "Warteschlange" (nächste 5 Leads
 *    als kompakte Zeilen, Click → Detail).
 *
 * Auf der Hero-Karte kann das Frontdesk den Anruf direkt festhalten
 * (Erreicht / Termin vereinbart / Nicht erreicht). Das ist kein neuer
 * Schreibpfad: es ruft dieselbe `logCall`-Action wie das Lead-Cockpit und
 * fällt damit in die "Portal-native" Vorbuchungs-Phase (siehe actions.ts).
 * Ist der Lead an einen PVS-Termin gebunden, besitzt die PVS den Status —
 * der Statuswechsel entfällt dann und nur der Anruf wird protokolliert.
 */
export function CallQueue({
  leads,
  dueCount = 0,
  countryCode = "49",
  ruleStart,
}: {
  leads: CallQueueLead[];
  /** K-3: 48-Werkstunden rule start of the Praxis (signing date). */
  ruleStart?: Date | null;
  /** Clinic-wide count of Wiedervorlagen due now — may exceed the visible rows. */
  dueCount?: number;
  /** Country calling code for national numbers ("0170 ...") in WhatsApp links. */
  countryCode?: string;
}) {
  if (leads.length === 0) return null;

  const [hero, ...queue] = leads;

  return (
    <section
      aria-label="Anrufliste"
      className="space-y-4 rounded-2xl border border-border bg-bg-secondary p-4 md:p-5"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold md:text-2xl">
            Jetzt anrufen
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Diese Anfragen zuerst: fällige Wiedervorlagen, dann die nächste Antwortfrist.
          </p>
          {dueCount > 0 && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-fg-primary">
              <AlarmClock className="h-4 w-4 text-tone-warn" aria-hidden />
              {dueCount} Wiedervorlage{dueCount === 1 ? "" : "n"} fällig
            </p>
          )}
        </div>
        <Link
          href="/anfragen?status=neu,termin_vereinbart"
          className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-accent"
        >
          Alle offenen Anfragen
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {hero && <HeroCard lead={hero} countryCode={countryCode} ruleStart={ruleStart} />}

      {queue.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium text-fg-primary">
            Als Nächstes <span className="font-normal text-fg-secondary">{queue.length}</span>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-primary">
            {queue.map((l) => (
              <QueueRow key={l.id} lead={l} ruleStart={ruleStart} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HeroCard({
  lead,
  countryCode,
  ruleStart,
}: {
  lead: CallQueueLead;
  countryCode: string;
  ruleStart?: Date | null;
}) {
  const phoneHref = lead.contactPhone ? `tel:${lead.contactPhone}` : null;
  const whatsappHref = waMeHref(lead.contactPhone, countryCode);
  const answers = quizAnswerLines(lead.quiz);
  const emailHref = lead.contactEmail ? `mailto:${lead.contactEmail}` : null;
  const treatment = lead.treatmentName ?? lead.treatmentWish;
  const source = SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS] ?? lead.source;

  return (
    <Card className="relative overflow-hidden !border-accent bg-bg-primary p-5 md:p-6">
      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-3">
          <div className="text-sm font-medium text-fg-primary">Nächster Anruf</div>

          <div className="space-y-1.5">
            <h3 className="text-2xl font-semibold leading-tight md:text-3xl">
              {lead.contactName ?? "Unbekannt"}
            </h3>
            <FactsLine lead={lead} explain />
            <div className="text-sm text-fg-secondary">
              {[treatment, source, `eingegangen ${formatRelative(lead.createdAt)}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <TimingLine timing={timingOf(lead, ruleStart)} explain className="text-base" />
          </div>

          {answers.length > 0 && (
            <p className="text-sm text-fg-primary">
              {answers.map((a) => `${a.label}: ${a.value}`).join(" · ")}
            </p>
          )}

          {lead.message && (
            <blockquote className="rounded-lg border-l-2 border-accent bg-bg-secondary px-3 py-2 text-sm leading-relaxed text-fg-primary">
              {truncate(lead.message, 320)}
            </blockquote>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            {lead.contactPhone ? (
              <a
                href={phoneHref!}
                className="inline-flex items-center gap-1.5 font-medium text-fg-primary hover:text-accent"
              >
                <Phone className="h-4 w-4 text-fg-secondary" />
                <span className="tabular-nums">{lead.contactPhone}</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                <Phone className="h-4 w-4" /> Keine Telefonnummer
              </span>
            )}
            {lead.contactEmail && (
              <a
                href={emailHref!}
                className="inline-flex min-w-0 items-center gap-1.5 truncate text-fg-secondary hover:text-accent"
              >
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{lead.contactEmail}</span>
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 md:min-w-[12rem] md:justify-center">
          {phoneHref && (
            <Button asChild size="lg" className="justify-center">
              <a href={phoneHref}>
                <Phone className="h-5 w-5" />
                Anrufen
              </a>
            </Button>
          )}
          {whatsappHref && (
            <Button asChild size="lg" variant="outline" className="justify-center">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-5 w-5" />
                WhatsApp
              </a>
            </Button>
          )}
          {emailHref && (
            <Button asChild size="lg" variant="outline" className="justify-center">
              <a href={emailHref}>
                <Mail className="h-5 w-5" />
                E-Mail
              </a>
            </Button>
          )}
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="justify-center text-fg-secondary"
          >
            <Link href={`/anfragen/${lead.id}`}>
              Details öffnen
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <CallOutcomeActions
          requestId={lead.id}
          currentStatus={lead.status}
          pvsControlled={lead.pvsControlled}
        />
      </div>
    </Card>
  );
}

function QueueRow({ lead, ruleStart }: { lead: CallQueueLead; ruleStart?: Date | null }) {
  const phoneHref = lead.contactPhone ? `tel:${lead.contactPhone}` : null;

  return (
    <li>
      {/* Phones: the button sits in the top-right corner, so the lines below
          the name keep the full width (the Frist must not be cut off). */}
      <div className="relative flex items-center gap-4 px-4 py-3 transition hover:bg-bg-secondary md:px-5">
        <Link href={`/anfragen/${lead.id}`} className="min-w-0 flex-1 space-y-1">
          <div
            className={`truncate text-base font-semibold text-fg-primary md:pr-0 ${phoneHref ? "pr-12" : "pr-24"}`}
          >
            {lead.contactName ?? "Unbekannt"}
          </div>
          <FactsLine lead={lead} />
          <div className="truncate text-sm text-fg-secondary">
            {[
              lead.treatmentName ?? lead.treatmentWish ?? "Keine Angabe",
              lead.contactPhone,
              formatRelative(lead.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <TimingLine timing={timingOf(lead, ruleStart)} className="max-w-full" />
        </Link>

        <div className="absolute right-4 top-3 shrink-0 md:static">
          {phoneHref ? (
            <Button asChild size="sm" aria-label="Anrufen">
              <a href={phoneHref}>
                <Phone className="h-4 w-4" />
                <span className="hidden md:inline">Anrufen</span>
              </a>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={`/anfragen/${lead.id}`}>Details</Link>
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Status first, then the plain facts: same order as the Anfragen list on
 * phones. The score is a fact, not a state, so it carries no coloured dot.
 */
function FactsLine({ lead, explain = false }: { lead: CallQueueLead; explain?: boolean }) {
  const score =
    lead.aiScore != null ? aiScoreText(lead.aiScore) : aiCategoryWord(lead.aiCategory);
  return (
    <div className="flex min-w-0 items-center gap-x-1.5 overflow-hidden text-sm text-fg-secondary">
      <StatusPill status={lead.status} />
      {score && (
        <span className="inline-flex items-center whitespace-nowrap tabular-nums" title={AI_SCORE_EXPLANATION}>
          · KI {score}
          {explain && (
            <ExplainerPopover term="KI-Bewertung" ariaLabel="Erklärung zur KI-Bewertung">
              {AI_SCORE_EXPLANATION}
            </ExplainerPopover>
          )}
        </span>
      )}
      {isFollowupDue(lead) && (
        <Badge tone="warn" className="ml-1">
          <AlarmClock aria-hidden />
          Wiedervorlage fällig
        </Badge>
      )}
    </div>
  );
}

/** The one timing line (Frist, Rückruf-Ziel, flags), shared with the list. */
function timingOf(lead: CallQueueLead, ruleStart?: Date | null) {
  return rowTiming(
    {
      createdAt: lead.createdAt,
      firstAttemptAt: lead.firstAttemptAt,
      status: lead.status,
      ruleStart,
      firstContactedAt: lead.firstContactedAt,
      slaRespondBy: lead.slaRespondBy,
    },
    new Date()
  );
}

function isFollowupDue(lead: CallQueueLead): boolean {
  return !!lead.nextFollowupAt && lead.nextFollowupAt.getTime() <= Date.now();
}

/**
 * Strip phone formatting to a wa.me-compatible E.164-ish digits string.
 * The "(0)" in "+49 (0) 170 ..." is dropped first (C-32). Leading `00` or
 * `+` → drop; leading `0` (national) → the Praxis' country code. Returns
 * null if too few digits to be a real number.
 */
function waMeHref(phone: string | null, countryCode: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\(\s*0\s*\)/g, "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
