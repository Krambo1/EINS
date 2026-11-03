import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@eins/ui";
import { formatDate, formatDateTime, formatMoney, type CurrencyCode } from "@/lib/formatting";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { CARD_TITLE } from "../../dashboard/_components/dash-ui";
import { Fact, Missing } from "./_fact";
import { LiveTimeFacts, type ClockInput } from "./_live-status";
import { RevokeAdsConsentButton } from "./_revoke-ads-consent";
import { DETAIL_FACT_COLUMNS } from "./_lib/sizes";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-[15px] font-medium leading-5 text-fg-primary">{title}</h3>
      <dl className="mt-2 divide-y divide-border border-t border-border [--scroll-bg:var(--surface-tile)]">{children}</dl>
    </div>
  );
}

function Id({ label, value }: { label: string; value: string | null }) {
  return (
    <Fact label={label} columns={DETAIL_FACT_COLUMNS}>
      {value ? <span className="tabular-nums">{value}</span> : <Missing>Keine</Missing>}
    </Fact>
  );
}

/**
 * Shortened consent IP (C-27): last IPv4 octet zeroed, IPv6 cut to the
 * first three groups. Enough to show that consent came from a real request,
 * not enough to identify the device.
 */
function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (v4) return `${v4[1]}.0`;
  if (ip.includes(":")) {
    return `${ip.split(":").slice(0, 3).join(":")}::`;
  }
  return null;
}

/**
 * Everything that is kept but not needed in the call, one level deeper
 * (Stripe's customer page: "Details" and "Metadata" folded below the
 * activity): the clock of the 48-Werkstunden rule, both consents with
 * "Widerrufen", the ids, and for the Inhaber the raw form data. Closed it is
 * one row that names what is inside, so nothing has to be searched for. A
 * native <details>, so it opens without JavaScript too.
 */
export function DetailsCard({
  requestId,
  name,
  canWork,
  clock,
  adsConsentAt,
  adsConsentRevokedAt,
  dsgvoConsentAt,
  dsgvoConsentIp,
  ids,
  revenue,
  currency,
  rawPayload,
  className,
}: {
  requestId: string;
  name: string;
  canWork: boolean;
  clock: ClockInput;
  adsConsentAt: Date | null;
  adsConsentRevokedAt: Date | null;
  dsgvoConsentAt: Date | null;
  dsgvoConsentIp: string | null;
  ids: { request: string; patient: string | null; campaign: string | null; ad: string | null };
  revenue: number | null;
  currency: CurrencyCode;
  /** Only for `audit.view` (C-27), and only when the form sent something. */
  rawPayload: unknown;
  className?: string;
}) {
  const sections = ["Frist und Kontakt", "Einwilligungen", "Kennungen", ...(rawPayload ? ["Formulardaten"] : [])];
  const ip = maskIp(dsgvoConsentIp);
  return (
    <section
      className={cn(
        "anim-rise elev-card lift min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]",
        className
      )}
    >
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--r-card)] px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:px-6 md:py-6 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span role="heading" aria-level={2} className={cn(CARD_TITLE, "block")}>
              Details
            </span>
            <span className="mt-1 block text-sm leading-5 text-fg-secondary">{sections.join(", ")}</span>
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-fg-secondary transition-transform duration-300 group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <div className="px-5 pb-5 md:px-6 md:pb-6">
          <Section title="Frist und Kontakt">
            <LiveTimeFacts clock={clock} />
          </Section>

          <Section title="Einwilligungen">
            {/* The button is as tall as the row, so it sits in it without growing it. */}
            <Fact label="Meta und Google" scroll={false} columns={DETAIL_FACT_COLUMNS}>
              {adsConsentRevokedAt ? (
                `Widerrufen am ${formatDate(adsConsentRevokedAt)}`
              ) : adsConsentAt ? (
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0">Erteilt am {formatDate(adsConsentAt)}</span>
                  {canWork && <RevokeAdsConsentButton requestId={requestId} name={name} />}
                </span>
              ) : (
                <Missing>Nicht erteilt</Missing>
              )}
            </Fact>
            <Fact label="Datenschutz" lines={2} columns={DETAIL_FACT_COLUMNS}>
              {dsgvoConsentAt ? (
                <>
                  <span className="block tabular-nums">Erteilt am {formatDateTime(dsgvoConsentAt)}</span>
                  <span className="block h-5 text-sm tabular-nums text-fg-secondary">
                    {ip ? `IP ${ip} (gekürzt)` : "Ohne IP"}
                  </span>
                </>
              ) : (
                <>
                  <Missing>Keine</Missing>
                  <span className="block text-sm text-fg-secondary">Anruf, Buchung oder Eintrag am Empfang</span>
                </>
              )}
            </Fact>
          </Section>

          <Section title="Kennungen">
            <Id label="Anfrage-ID" value={ids.request} />
            <Id label="Patient-ID" value={ids.patient} />
            <Id label="Kampagnen-ID" value={ids.campaign} />
            <Id label="Anzeigen-ID" value={ids.ad} />
            <Fact label="Umsatz" columns={DETAIL_FACT_COLUMNS}>
              {revenue ? <span className="tabular-nums">{formatMoney(revenue, currency)}</span> : <Missing>Keiner</Missing>}
            </Fact>
          </Section>

          {rawPayload ? (
            <div className="mt-6">
              <h3 className="text-[15px] font-medium leading-5 text-fg-primary">Übermittelte Formulardaten</h3>
              <ScrollHint className="mt-2">
                <pre
                  tabIndex={0}
                  aria-label="Übermittelte Formulardaten"
                  className="scroll-shadows elev-inset h-64 overflow-auto rounded-[var(--r-panel)] px-4 py-3 font-mono text-xs leading-5 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {JSON.stringify(rawPayload, null, 2)}
                </pre>
              </ScrollHint>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}
