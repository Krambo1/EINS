import type { ReactNode } from "react";
import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { Button, StatusPill, cn } from "@eins/ui";
import { formatDate, formatDateTime, formatMoney, type CurrencyCode } from "@/lib/formatting";
import type { FollowupRow } from "@/server/queries/followups";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { CONTROL, DashCard } from "../../dashboard/_components/dash-ui";
import { CopyEmailButton } from "../../bewertungen/feedback/[id]/_copy-email";
import { CenteredNote, waMeHref } from "../_components/CallQueue";
import { Fact, Missing, ROW_ICON_BUTTON } from "./_fact";
import { StatusMenu } from "./_lead-cockpit";
import { LiveFristFact, LiveNextFollowupFact, type ClockInput } from "./_live-status";
import { PvsCode } from "./_pvs-token-card";
import { RECORD_NAME_HEIGHT, SIBLING_BODY_HEIGHT } from "./_lib/sizes";

export const CARD =
  "anim-rise elev-card lift min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6";

/** The name steps down with its length, so it fits the record's name block (the Rückmeldung's rule). */
function recordNameSize(name: string): string {
  const n = name.length;
  if (n <= 28) return "text-2xl leading-8";
  if (n <= 52) return "text-xl leading-6";
  return "text-base leading-6";
}

/** What the PVS row shows: nothing (no PVS connected), the code to paste, or that the Termin is linked. */
export type PvsRow = null | { linked: true } | { linked: false; token: string; vendor: string | null };

/**
 * The Anfrage as a record (Attio's record page, HubSpot's and Close's
 * contact sidebar): the name, the one thing to do (call; e-mail without a
 * number), then one fact per row in the order the person asks: how to reach
 * them, where it stands and what is due, what they want and where they came
 * from. Every row keeps its height; a missing fact says so in its row.
 * Below md the call sits in the bar at the bottom, not here.
 */
export function RecordCard({
  requestId,
  name,
  phone,
  email,
  countryCode,
  status,
  pvsControlled,
  canWork,
  clock,
  followups,
  treatment,
  source,
  post,
  locationName,
  createdAt,
  pvs,
  className,
}: {
  requestId: string;
  name: string;
  phone: string | null;
  email: string | null;
  countryCode: string;
  status: string;
  pvsControlled: boolean;
  canWork: boolean;
  clock: ClockInput;
  followups: FollowupRow[];
  /** The treatment, or the short wish, or null with `inMessage` when a long wish stands in the message. */
  treatment: { text: string | null; inMessage: boolean };
  source: ReactNode;
  post: string | null;
  locationName: string | null;
  createdAt: Date;
  pvs: PvsRow;
  className?: string;
}) {
  const whatsapp = waMeHref(phone, countryCode);
  return (
    <section aria-label="Angaben zur Anfrage" className={cn(CARD, className)}>
      <div className={cn("scroll-shadows flex [--scroll-bg:var(--surface-tile)]", RECORD_NAME_HEIGHT)}>
        <h1 className={cn("mt-auto min-w-0 break-words font-semibold text-fg-primary", recordNameSize(name))}>{name}</h1>
      </div>

      {/* flex: an inline-flex button in a block adds a line box (3 px). */}
      <div className="mt-4 hidden md:flex">
        {phone ? (
          <Button asChild className={cn(CONTROL, "w-full")}>
            <a href={`tel:${phone}`}>
              <Phone className="h-4 w-4" aria-hidden />
              Anrufen
            </a>
          </Button>
        ) : email ? (
          <Button asChild className={cn(CONTROL, "w-full")}>
            <a href={`mailto:${email}`}>
              <Mail className="h-4 w-4" aria-hidden />
              E-Mail schreiben
            </a>
          </Button>
        ) : (
          <Button disabled className={cn(CONTROL, "w-full")} title="Keine Telefonnummer und keine E-Mail-Adresse">
            <Phone className="h-4 w-4" aria-hidden />
            Anrufen
          </Button>
        )}
      </div>

      <dl className="mt-4 divide-y divide-border border-t border-border [--scroll-bg:var(--surface-tile)]">
        {/* The number and the address scroll on their own, so the buttons stay put. */}
        <Fact label="Telefon" scroll={false}>
          {phone ? (
            <span className="flex items-start justify-between gap-2">
              <span className="scroll-shadows-x min-w-0 flex-1 tabular-nums">{phone}</span>
              {whatsapp && (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Per WhatsApp schreiben"
                  title="WhatsApp"
                  className={ROW_ICON_BUTTON}
                >
                  <MessageCircle className="h-4 w-4" aria-hidden />
                </a>
              )}
            </span>
          ) : (
            <Missing>Keine Telefonnummer</Missing>
          )}
        </Fact>
        <Fact label="E-Mail" scroll={false}>
          {email ? (
            <span className="flex items-start justify-between gap-2">
              <span className="scroll-shadows-x min-w-0 flex-1">{email}</span>
              <span className="flex shrink-0 items-center gap-0.5">
                {/* With a number the main action is the call; writing sits here. */}
                {phone && (
                  <a href={`mailto:${email}`} aria-label="E-Mail schreiben" title="E-Mail schreiben" className={ROW_ICON_BUTTON}>
                    <Mail className="h-4 w-4" aria-hidden />
                  </a>
                )}
                <CopyEmailButton email={email} />
              </span>
            </span>
          ) : (
            <Missing>Keine E-Mail-Adresse</Missing>
          )}
        </Fact>
        <Fact label="Status" scroll={false}>
          <StatusMenu
            requestId={requestId}
            name={name}
            status={status}
            pvsControlled={pvsControlled}
            canWork={canWork}
          />
        </Fact>
        <LiveFristFact clock={clock} />
        <LiveNextFollowupFact requestId={requestId} followups={followups} />
        <Fact label="Behandlung">
          {treatment.text ?? <Missing>{treatment.inMessage ? "Steht in der Nachricht" : "Keine Angabe"}</Missing>}
        </Fact>
        <Fact label="Quelle" lines={2}>
          <span className="block h-5">{source}</span>
          <span className="block h-5 text-sm text-fg-secondary">{post ? `Beitrag „${post}“` : ""}</span>
        </Fact>
        <Fact label="Standort">{locationName ?? <Missing>Ohne Standort</Missing>}</Fact>
        <Fact label="Eingang">
          <span className="tabular-nums">{formatDateTime(createdAt)}</span>
        </Fact>
        {pvs && (
          <Fact label="PVS" scroll={false}>
            {pvs.linked ? "Mit Termin verknüpft" : <PvsCode token={pvs.token} pvsVendor={pvs.vendor} />}
          </Fact>
        )}
      </dl>
    </section>
  );
}

/**
 * Phone only (below md): the one main action, fixed to the bottom above the
 * safe-area inset (Close's and HubSpot's mobile call bar). Calling, or
 * writing when there is no number; nothing that is on the page above. The
 * page adds bottom padding so it never covers the last card.
 */
export function MobileActionBar({ phone, email }: { phone: string | null; email: string | null }) {
  const href = phone ? `tel:${phone}` : email ? `mailto:${email}` : null;
  if (!href) return null;
  return (
    <div
      role="region"
      aria-label="Kontakt"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[var(--surface-tile)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:hidden"
    >
      <Button asChild className={cn(CONTROL, "w-full")}>
        <a href={href}>
          {phone ? <Phone className="h-4 w-4" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}
          {phone ? "Anrufen" : "E-Mail schreiben"}
        </a>
      </Button>
    </div>
  );
}

/**
 * The patient's other Anfragen and what they have paid in all (Stripe's
 * customer page: the total as the header figure, the list under it). Two
 * lines per row, a fixed body of three rows that scrolls after that.
 */
export function SiblingsCard({
  siblings,
  lifetimeRevenue,
  currency,
  className,
}: {
  siblings: Array<{ id: string; treatmentWish: string | null; status: string; createdAt: Date; convertedRevenueEur: number | null }>;
  lifetimeRevenue: number | null;
  currency: CurrencyCode;
  className?: string;
}) {
  return (
    <DashCard
      title="Weitere Anfragen"
      className={className}
      action={
        lifetimeRevenue != null && lifetimeRevenue > 0 ? (
          <span className="flex items-baseline gap-2 text-sm leading-5">
            <span className="text-fg-secondary">Gesamtumsatz</span>
            <span className="font-semibold tabular-nums text-fg-primary">{formatMoney(lifetimeRevenue, currency)}</span>
          </span>
        ) : undefined
      }
    >
      <ScrollHint>
        <div
          role="region"
          aria-label="Weitere Anfragen dieser Person"
          tabIndex={0}
          className={cn(
            "scroll-shadows -mx-2 -my-3 overflow-y-auto px-2 [--scroll-bg:var(--surface-tile)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            SIBLING_BODY_HEIGHT,
            siblings.length === 0 && "flex"
          )}
        >
          {siblings.length === 0 ? (
            <CenteredNote title="Keine weiteren Anfragen." />
          ) : (
            <ul className="divide-y divide-border">
              {siblings.map((s) => (
                <li key={s.id} className="py-3">
                  <Link
                    href={`/anfragen/${s.id}`}
                    className="group block rounded-[var(--r-small)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="scroll-shadows-x block whitespace-nowrap text-[15px] font-medium leading-5 text-fg-primary decoration-fg-tertiary underline-offset-4 group-hover:underline">
                      {s.treatmentWish ?? "Anfrage ohne Wunsch"}
                    </span>
                    <span className="flex h-5 items-center gap-1.5 whitespace-nowrap text-sm leading-5 text-fg-secondary">
                      <span className="tabular-nums">{formatDate(s.createdAt)}</span>
                      <span aria-hidden>·</span>
                      <StatusPill status={s.status} className="font-normal" />
                      {s.convertedRevenueEur != null && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="tabular-nums text-fg-primary">{formatMoney(s.convertedRevenueEur, currency)}</span>
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollHint>
    </DashCard>
  );
}
