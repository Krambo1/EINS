import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  SAME_PERSON_DAYS,
  utmForBookingLink,
  utmForTrackingNumber,
  type BookingLinkMedium,
  type MesswegEvent,
  type TrackingNumberChannel,
} from "@/lib/messweg";
import { persistLead } from "@/server/leads";

export type MesswegOutcome = "angelegt" | "zusammengefasst" | "ohne_praxis" | "ignoriert";

/**
 * A claim still 'in_arbeit' after this long belongs to a run that died
 * between claim and result (the route's maxDuration is 60 s). The next
 * provider retry takes it over instead of being swallowed.
 */
const STALE_CLAIM_SECONDS = 180;

/** Another run is processing this delivery right now: the provider should retry later. */
export class MesswegBusyError extends Error {
  constructor() {
    super("messweg delivery is being processed");
    this.name = "MesswegBusyError";
  }
}

export interface IngestResult {
  outcome: MesswegOutcome;
  clinicId: string | null;
  requestId: string | null;
  /** True when this delivery was already processed (provider retry). */
  replay: boolean;
}

/**
 * One call or booking from a provider → one Anfrage (or one activity on the
 * Anfrage of the same person within 30 days), through persistLead, the only
 * place that creates requests.
 *
 * Idempotent on (provider, externalId): the messweg_events row is claimed
 * FIRST (outcome 'in_arbeit'), so two concurrent deliveries of the same call
 * never create two Anfragen. If processing fails, the claim is released so
 * the provider's retry can succeed; if the process dies before that, a retry
 * takes over the stale claim (STALE_CLAIM_SECONDS).
 *
 * Stored in the log: provider facts only. The caller number lives on the
 * Anfrage (and is anonymised with it); the log keeps its last 4 digits.
 */
export async function ingestMesswegEvent(event: MesswegEvent): Promise<IngestResult> {
  const sameDelivery = and(
    eq(schema.messwegEvents.provider, event.provider),
    eq(schema.messwegEvents.externalId, event.externalId)
  );
  let [claim] = await db
    .insert(schema.messwegEvents)
    .values({
      provider: event.provider,
      externalId: event.externalId,
      kind: event.kind,
      outcome: "in_arbeit",
      occurredAt: event.occurredAt,
      meta: logMeta(event) as never,
    })
    .onConflictDoNothing()
    .returning({ id: schema.messwegEvents.id });

  if (!claim) {
    // Take over a claim whose run died (atomic: only one retry wins).
    [claim] = await db
      .update(schema.messwegEvents)
      .set({ receivedAt: sql`now()` })
      .where(
        and(
          sameDelivery,
          eq(schema.messwegEvents.outcome, "in_arbeit"),
          lt(schema.messwegEvents.receivedAt, sql`now() - make_interval(secs => ${STALE_CLAIM_SECONDS})`)
        )
      )
      .returning({ id: schema.messwegEvents.id });
  }

  if (!claim) {
    const [prev] = await db
      .select({
        outcome: schema.messwegEvents.outcome,
        clinicId: schema.messwegEvents.clinicId,
        requestId: schema.messwegEvents.requestId,
      })
      .from(schema.messwegEvents)
      .where(sameDelivery)
      .limit(1);
    if (prev?.outcome === "in_arbeit") throw new MesswegBusyError();
    return {
      outcome: (prev?.outcome as MesswegOutcome) ?? "ignoriert",
      clinicId: prev?.clinicId ?? null,
      requestId: prev?.requestId ?? null,
      replay: true,
    };
  }

  try {
    const target = await resolveTarget(event);
    if (!target) {
      // Number or link not assigned to any Praxis: kept in the log for EINS.
      await db
        .update(schema.messwegEvents)
        .set({ outcome: "ohne_praxis" })
        .where(eq(schema.messwegEvents.id, claim.id));
      return { outcome: "ohne_praxis", clinicId: null, requestId: null, replay: false };
    }

    const persisted = await persistLead(target.clinicId, {
      source: event.kind,
      utm: target.utm,
      contactName: event.contactName,
      contactEmail: event.contactEmail,
      contactPhone: event.contactPhone,
      treatmentWish: null,
      // A call or booking carries no form consent (leads.ts stores NULL).
      dsgvoConsent: false,
      consents: null,
      rawPayload: { messweg: logMeta(event) },
      trackingNumberId: target.trackingNumberId,
      bookingLinkId: target.bookingLinkId,
      appointmentAt: event.kind === "buchung" ? event.appointmentAt : null,
      sameContactWithinDays: SAME_PERSON_DAYS,
      sameContactActivity: {
        body:
          event.kind === "anruf"
            ? "Dieselbe Person hat erneut über die EINS-Tracking-Nummer angerufen."
            : "Dieselbe Person hat erneut über den EINS-Buchungslink gebucht.",
        meta: { messweg: event.kind, provider: event.provider, externalId: event.externalId },
      },
    });

    const outcome: MesswegOutcome = persisted.status === "same_contact" ? "zusammengefasst" : "angelegt";
    await db
      .update(schema.messwegEvents)
      .set({ outcome, clinicId: target.clinicId, requestId: persisted.id })
      .where(eq(schema.messwegEvents.id, claim.id));
    return { outcome, clinicId: target.clinicId, requestId: persisted.id, replay: false };
  } catch (err) {
    await db.delete(schema.messwegEvents).where(eq(schema.messwegEvents.id, claim.id));
    throw err;
  }
}

interface Target {
  clinicId: string;
  utm: Record<string, string>;
  trackingNumberId: string | null;
  bookingLinkId: string | null;
}

async function resolveTarget(event: MesswegEvent): Promise<Target | null> {
  if (event.kind === "anruf") {
    const [n] = await db
      .select({
        id: schema.trackingNumbers.id,
        clinicId: schema.trackingNumbers.clinicId,
        channel: schema.trackingNumbers.channel,
      })
      .from(schema.trackingNumbers)
      .where(and(eq(schema.trackingNumbers.e164, event.calledNumber), eq(schema.trackingNumbers.active, true)))
      .limit(1);
    if (!n) return null;
    return {
      clinicId: n.clinicId,
      utm: utmForTrackingNumber(n.channel as TrackingNumberChannel, event.utm),
      trackingNumberId: n.id,
      bookingLinkId: null,
    };
  }
  const [l] = await db
    .select({
      id: schema.bookingLinks.id,
      clinicId: schema.bookingLinks.clinicId,
      medium: schema.bookingLinks.medium,
    })
    .from(schema.bookingLinks)
    .where(
      and(
        eq(schema.bookingLinks.provider, event.provider),
        eq(schema.bookingLinks.externalRef, event.bookingRef),
        eq(schema.bookingLinks.active, true)
      )
    )
    .limit(1);
  if (!l) return null;
  return {
    clinicId: l.clinicId,
    utm: utmForBookingLink(l.medium as BookingLinkMedium, event.utm),
    trackingNumberId: null,
    bookingLinkId: l.id,
  };
}

/** Provider facts for the log. Caller number reduced to its last 4 digits. */
export function logMeta(event: MesswegEvent): Record<string, unknown> {
  const tail = (event.contactPhone ?? "").replace(/\D/g, "").slice(-4) || null;
  if (event.kind === "anruf") {
    return {
      calledNumber: event.calledNumber,
      callerTail: tail,
      durationSec: event.durationSec,
      callStatus: event.callStatus,
      utm: event.utm,
    };
  }
  return {
    bookingRef: event.bookingRef,
    appointmentAt: event.appointmentAt?.toISOString() ?? null,
    contactTail: tail,
    utm: event.utm,
  };
}
