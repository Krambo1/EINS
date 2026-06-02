import Link from "next/link";
import {
  Card,
  Badge,
  StatusPill,
  Button,
} from "@eins/ui";
import {
  AlertTriangle,
  AlarmClock,
  ArrowRight,
  MessageCircle,
  Mail,
  Phone,
  Sparkles,
} from "lucide-react";
import {
  SOURCE_LABELS,
  AI_CATEGORY_LABELS,
  type AiCategory,
} from "@/lib/constants";
import { SourceLabel } from "@/app/_components/Brand";
import { formatRelative } from "@/lib/formatting";
import type { CallQueueLead } from "@/server/queries/requests";
import { CallOutcomeActions } from "./CallOutcomeActions";

/**
 * Call-Center-Header für die Anfragen-Seite. Wird ausschließlich für
 * MFA/Sekretariat (role=frontdesk) gerendert. Inhaber/Marketing sehen
 * weiterhin die reine Liste, weil deren Job nicht "anrufen" ist.
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
}: {
  leads: CallQueueLead[];
  /** Clinic-wide count of Wiedervorlagen due now — may exceed the visible rows. */
  dueCount?: number;
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
            Jetzt anrufen.
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Diese Anfragen zuerst — sortiert nach Dringlichkeit und KI-Bewertung.
          </p>
          {dueCount > 0 && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-tone-warn">
              <AlarmClock className="h-4 w-4" />
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

      {hero && <HeroCard lead={hero} />}

      {queue.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Als Nächstes ({queue.length})
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-primary">
            {queue.map((l) => (
              <QueueRow key={l.id} lead={l} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HeroCard({ lead }: { lead: CallQueueLead }) {
  const slaBreached = isSlaBreached(lead);
  const phoneHref = lead.contactPhone ? `tel:${lead.contactPhone}` : null;
  const whatsappHref = waMeHref(lead.contactPhone);
  const emailHref = lead.contactEmail ? `mailto:${lead.contactEmail}` : null;

  return (
    <Card className="relative overflow-hidden border-accent/40 bg-bg-primary p-5 md:p-6">
      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            Nächster Anruf
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-2xl font-semibold leading-tight md:text-3xl">
              {lead.contactName ?? "Unbekannt"}
            </h3>
            <span className="text-sm text-fg-secondary tabular-nums">
              eingegangen {formatRelative(lead.createdAt)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={lead.status} />
            {lead.aiCategory && (
              <Badge
                tone={
                  lead.aiCategory === "hot"
                    ? "accent"
                    : lead.aiCategory === "warm"
                    ? "warn"
                    : "neutral"
                }
              >
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  {AI_CATEGORY_LABELS[lead.aiCategory as AiCategory]}
                  {lead.aiScore != null && (
                    <span className="tabular-nums">· {lead.aiScore}</span>
                  )}
                </span>
              </Badge>
            )}
            <Badge tone="neutral">
              <SourceLabel
                source={lead.source}
                label={
                  SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS] ??
                  lead.source
                }
              />
            </Badge>
            {(lead.treatmentName || lead.treatmentWish) && (
              <Badge tone="accent">
                {lead.treatmentName ?? lead.treatmentWish}
              </Badge>
            )}
            {slaBreached && (
              <Badge tone="bad">
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  SLA überfällig
                </span>
              </Badge>
            )}
            {isFollowupDue(lead) && (
              <Badge tone="warn">
                <span className="inline-flex items-center gap-1">
                  <AlarmClock className="h-3 w-3" />
                  Wiedervorlage fällig
                </span>
              </Badge>
            )}
          </div>

          {lead.message && (
            <blockquote className="rounded-lg border-l-2 border-accent/50 bg-bg-secondary px-3 py-2 text-sm leading-relaxed text-fg-primary">
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
              <span className="inline-flex items-center gap-1.5 text-fg-tertiary">
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

function QueueRow({ lead }: { lead: CallQueueLead }) {
  const slaBreached = isSlaBreached(lead);
  const phoneHref = lead.contactPhone ? `tel:${lead.contactPhone}` : null;

  return (
    <li>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-bg-secondary md:gap-4 md:px-5">
        <Link
          href={`/anfragen/${lead.id}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-base font-semibold text-fg-primary">
                {lead.contactName ?? "Unbekannt"}
              </span>
              {lead.aiCategory && (
                <Badge
                  tone={
                    lead.aiCategory === "hot"
                      ? "accent"
                      : lead.aiCategory === "warm"
                      ? "warn"
                      : "neutral"
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {lead.aiCategory === "hot"
                      ? "Heiß"
                      : lead.aiCategory === "warm"
                      ? "Warm"
                      : "Kalt"}
                  </span>
                </Badge>
              )}
              {slaBreached && (
                <Badge tone="bad">
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Überfällig
                  </span>
                </Badge>
              )}
              {isFollowupDue(lead) && (
                <Badge tone="warn">
                  <span className="inline-flex items-center gap-1">
                    <AlarmClock className="h-3 w-3" />
                    Wiedervorlage
                  </span>
                </Badge>
              )}
            </div>
            <div className="mt-0.5 truncate text-sm text-fg-secondary">
              {lead.treatmentName ?? lead.treatmentWish ?? "Keine Angabe"}
              {lead.contactPhone ? ` · ${lead.contactPhone}` : ""}
            </div>
          </div>
        </Link>

        <div className="hidden shrink-0 text-right md:block">
          <StatusPill status={lead.status} />
          <div className="mt-1 text-xs text-fg-tertiary tabular-nums">
            {formatRelative(lead.createdAt)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {phoneHref ? (
            <Button asChild size="sm">
              <a href={phoneHref}>
                <Phone className="h-4 w-4" />
                Anrufen
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

function isSlaBreached(lead: CallQueueLead): boolean {
  return (
    !lead.firstContactedAt &&
    !!lead.slaRespondBy &&
    lead.slaRespondBy.getTime() < Date.now()
  );
}

function isFollowupDue(lead: CallQueueLead): boolean {
  return !!lead.nextFollowupAt && lead.nextFollowupAt.getTime() <= Date.now();
}

/**
 * Strip phone formatting to a wa.me-compatible E.164-ish digits string.
 * Leading `00` → drop; leading `0` (German national) → `49`; leading `+` →
 * drop. Returns null if too few digits to be a real number.
 */
function waMeHref(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = "49" + digits.slice(1);
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
