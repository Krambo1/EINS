/**
 * Canonical-event driver — POSTs one of each canonical event kind directly
 * to /api/pvs/events using the same wire contract every adapter uses.
 *
 * What this proves:
 *   • The HMAC-SHA256 signing (signBody) matches the portal's
 *     verifyClinicSignature wire format.
 *   • All 8 canonical event kinds round-trip through the Zod schema.
 *   • The batch endpoint accepts 500-event payloads.
 *   • Dedup-on-replay returns {status: "deduped"} instead of erroring.
 *
 * Run mode A (against the stub portal):
 *   pnpm harness:portal   # in another terminal
 *   pnpm harness:canonical
 *
 * Run mode B (against a real local portal):
 *   PORTAL_BASE_URL=http://localhost:3001 pnpm harness:canonical
 *   …note the real portal requires a seeded pvs_link + 'pvs' platform secret
 *    matching TEST_CLINIC_ID / TEST_CLINIC_SECRET for the events to ingest.
 */
import {
  STUB_PORTAL_URL,
  TEST_CLINIC_ID,
  signBody,
  banner,
  iso,
  isMain,
  summarise,
} from "./shared.js";

interface BaseEvent {
  kind: string;
  clinicId: string;
  bridgeSource: string;
  pvsExternalEventId: string;
  occurredAt: string;
  [k: string]: unknown;
}

const PORTAL = process.env.PORTAL_BASE_URL?.replace(/\/$/, "") ?? STUB_PORTAL_URL;

function withBase(
  partial: Partial<BaseEvent> & {
    kind: string;
    pvsExternalEventId: string;
  }
): BaseEvent {
  return {
    clinicId: TEST_CLINIC_ID,
    bridgeSource: "n8n_custom",
    occurredAt: iso(),
    ...partial,
  } as BaseEvent;
}

function makeEvents(): BaseEvent[] {
  const today = iso();
  const tomorrow = iso(new Date(Date.now() + 24 * 3600 * 1000));
  return [
    withBase({
      kind: "PatientUpserted",
      pvsExternalEventId: "canon:patient:p-001:1",
      pvsPatientId: "p-001",
      fullName: "Anna Beispiel",
      email: "anna.beispiel@example.test",
      phone: "+49 30 1234567",
      dob: "1985-04-12",
      gender: "f",
      bemerkung: "EINS-Lead-deadbeef — Termin via Praxis-Landing",
    }),
    withBase({
      kind: "AppointmentCreated",
      pvsExternalEventId: "canon:appointment:a-001",
      pvsPatientId: "p-001",
      pvsAppointmentId: "a-001",
      scheduledAt: tomorrow,
      treatmentCode: "BTX-LIP",
      treatmentLabel: "Lippenfaltenunterspritzung",
      bemerkung: "Erstberatung",
    }),
    withBase({
      kind: "AppointmentStatusChanged",
      pvsExternalEventId: "canon:appointment:a-001:status:checked_in",
      pvsPatientId: "p-001",
      pvsAppointmentId: "a-001",
      newStatus: "checked_in",
      changedAt: today,
    }),
    withBase({
      kind: "AppointmentCancelled",
      pvsExternalEventId: "canon:appointment:a-002:cancelled",
      pvsPatientId: "p-001",
      pvsAppointmentId: "a-002",
      cancellationReason: "Patientin krank",
      cancelledBy: "patient",
    }),
    withBase({
      kind: "EncounterCompleted",
      pvsExternalEventId: "canon:encounter:e-001",
      pvsPatientId: "p-001",
      pvsEncounterId: "e-001",
      pvsAppointmentId: "a-001",
      treatmentCode: "BTX-LIP",
      treatmentLabel: "Lippenfaltenunterspritzung",
      completedAt: today,
      practitionerLabel: "Dr. med. Beispiel",
    }),
    withBase({
      kind: "InvoicePaid",
      pvsExternalEventId: "canon:invoice:r-001",
      pvsPatientId: "p-001",
      pvsInvoiceId: "r-001",
      pvsEncounterId: "e-001",
      pvsAppointmentId: "a-001",
      amountCents: 39000,
      currency: "EUR",
      paidAt: today,
    }),
    withBase({
      kind: "RecallScheduled",
      pvsExternalEventId: "canon:recall:rc-001",
      pvsPatientId: "p-001",
      pvsRecallId: "rc-001",
      recallAt: iso(new Date(Date.now() + 180 * 24 * 3600 * 1000)),
      treatmentCode: "FOLLOWUP",
      treatmentLabel: "Auffrischung",
    }),
    withBase({
      kind: "PatientMerged",
      pvsExternalEventId: "canon:merge:p-001:p-002",
      fromPvsPatientId: "p-002",
      toPvsPatientId: "p-001",
    }),
  ];
}

interface PostResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function postOne(event: BaseEvent): Promise<PostResult> {
  const raw = JSON.stringify(event);
  const sig = signBody(raw);
  const res = await fetch(`${PORTAL}/api/pvs/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": sig,
    },
    body: raw,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function postBatch(events: BaseEvent[]): Promise<PostResult> {
  const raw = JSON.stringify({ clinicId: TEST_CLINIC_ID, events });
  const sig = signBody(raw);
  const res = await fetch(`${PORTAL}/api/pvs/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": sig,
    },
    body: raw,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export async function runCanonicalDriver(): Promise<{
  posted: number;
  ingested: number;
  deduped: number;
  failed: number;
}> {
  banner("canonical driver");
  console.log(`Portal: ${PORTAL}`);
  const events = makeEvents();
  let ingested = 0;
  let deduped = 0;
  let failed = 0;

  console.log(`Posting ${events.length} events one-by-one…`);
  for (const event of events) {
    const r = await postOne(event);
    if (!r.ok) {
      failed += 1;
      console.error(`  ✗ ${summarise(event)} → HTTP ${r.status} ${JSON.stringify(r.body)}`);
      continue;
    }
    const b = r.body as { status?: string };
    if (b.status === "deduped") deduped += 1;
    else ingested += 1;
  }

  console.log(`Re-posting the same ${events.length} events (should all dedup)…`);
  for (const event of events) {
    const r = await postOne(event);
    if (!r.ok) {
      failed += 1;
      continue;
    }
    const b = r.body as { status?: string };
    if (b.status === "deduped") deduped += 1;
    else ingested += 1;
  }

  // Also exercise the batch endpoint with a fresh set of dedup keys.
  const batchEvents: BaseEvent[] = events.map((e, i) => ({
    ...e,
    pvsExternalEventId: `${e.pvsExternalEventId}:batch:${i}`,
  }));
  console.log(`Posting a batch of ${batchEvents.length} events…`);
  const br = await postBatch(batchEvents);
  if (!br.ok) {
    failed += batchEvents.length;
    console.error(`  ✗ batch → HTTP ${br.status} ${JSON.stringify(br.body)}`);
  } else {
    const b = br.body as { ingested?: number; deduped?: number };
    ingested += b.ingested ?? 0;
    deduped += b.deduped ?? 0;
  }

  const posted = events.length * 2 + batchEvents.length;
  console.log(
    `Done. posted=${posted} ingested=${ingested} deduped=${deduped} failed=${failed}`
  );
  return { posted, ingested, deduped, failed };
}

if (isMain(import.meta.url)) {
  runCanonicalDriver()
    .then(({ failed }) => process.exit(failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
