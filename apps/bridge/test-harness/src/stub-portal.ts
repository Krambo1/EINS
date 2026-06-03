import Fastify from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  STUB_PORTAL_PORT,
  TEST_CLINIC_ID,
  TEST_CLINIC_SECRET,
  banner,
  isMain,
  summarise,
} from "./shared.js";

/**
 * Stub of apps/portal /api/pvs/events + /api/pvs/events/batch.
 *
 * Mimics the same wire contract as the production endpoint:
 *   • Reads raw body, verifies sha256= HMAC in x-eins-signature header
 *   • Validates the canonical envelope with the same Zod discriminated union
 *   • Enforces dedup on (clinicId, bridgeSource, pvsExternalEventId, occurredAt)
 *   • Returns the same response shape ({ok: true, status: "ingested"|"deduped"})
 *
 * Differences vs. the real portal:
 *   • No DB: dedup is in-memory only
 *   • No pvs_link gate — every event is accepted regardless of vendor
 *   • No rate-limit / audit / patient-linking — those belong to portal tests
 *
 * The point is to prove the bridge's signing + canonical-encoding logic
 * end-to-end without standing up a Postgres + Next.js + worker stack.
 *
 * Stats are exposed via GET /__stats so drivers can assert what landed.
 */

const isoDatetime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const BridgeSource = z.enum([
  "tomedo",
  "healthhub",
  "red",
  "gdt_agent",
  "csv_upload",
  "n8n_custom",
]);
const baseFields = {
  clinicId: z.string().uuid(),
  bridgeSource: BridgeSource,
  pvsExternalEventId: z.string().min(1).max(200),
  occurredAt: isoDatetime,
} as const;

const PatientUpserted = z.object({
  kind: z.literal("PatientUpserted"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(64).optional(),
  fullName: z.string().max(200).optional(),
  dob: isoDate.optional(),
  gender: z.enum(["f", "m", "d", "x"]).optional(),
  bemerkung: z.string().max(4000).optional(),
  externalId: z.string().max(200).optional(),
});
const AppointmentCreated = z.object({
  kind: z.literal("AppointmentCreated"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200),
  scheduledAt: isoDatetime,
  treatmentCode: z.string().max(200).optional(),
  treatmentLabel: z.string().max(200).optional(),
  locationCode: z.string().max(200).optional(),
  locationLabel: z.string().max(200).optional(),
  bemerkung: z.string().max(4000).optional(),
});
const AppointmentStatusChanged = z.object({
  kind: z.literal("AppointmentStatusChanged"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200),
  newStatus: z.enum([
    "scheduled",
    "checked_in",
    "completed",
    "no_show",
    "cancelled",
  ]),
  changedAt: isoDatetime.optional(),
});
const AppointmentCancelled = z.object({
  kind: z.literal("AppointmentCancelled"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200),
  cancellationReason: z.string().max(200).optional(),
  cancelledBy: z.enum(["patient", "clinic"]).optional(),
});
const EncounterCompleted = z.object({
  kind: z.literal("EncounterCompleted"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsEncounterId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200).optional(),
  treatmentCode: z.string().max(200).optional(),
  treatmentLabel: z.string().max(200).optional(),
  completedAt: isoDatetime,
  practitionerLabel: z.string().max(200).optional(),
});
const InvoicePaid = z.object({
  kind: z.literal("InvoicePaid"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsInvoiceId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200).optional(),
  pvsEncounterId: z.string().min(1).max(200).optional(),
  amountCents: z.number().int().nonnegative(),
  currency: z.literal("EUR").default("EUR"),
  paidAt: isoDatetime,
});
const RecallScheduled = z.object({
  kind: z.literal("RecallScheduled"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsRecallId: z.string().min(1).max(200),
  recallAt: isoDatetime,
  treatmentCode: z.string().max(200).optional(),
  treatmentLabel: z.string().max(200).optional(),
});
const PatientMerged = z.object({
  kind: z.literal("PatientMerged"),
  ...baseFields,
  fromPvsPatientId: z.string().min(1).max(200),
  toPvsPatientId: z.string().min(1).max(200),
});

const PvsEvent = z.discriminatedUnion("kind", [
  PatientUpserted,
  AppointmentCreated,
  AppointmentStatusChanged,
  AppointmentCancelled,
  EncounterCompleted,
  InvoicePaid,
  RecallScheduled,
  PatientMerged,
]);
type PvsEvent = z.infer<typeof PvsEvent>;

const Batch = z.object({
  clinicId: z.string().uuid(),
  events: z.array(PvsEvent).min(1).max(500),
});

interface Stats {
  /** Total accepted (ingested + deduped). */
  total: number;
  ingested: number;
  deduped: number;
  rejected: number;
  byKind: Record<string, number>;
  bySource: Record<string, number>;
  /** All distinct dedup keys we've seen, in insertion order. */
  events: Array<{
    receivedAt: string;
    kind: string;
    bridgeSource: string;
    pvsExternalEventId: string;
    summary: string;
  }>;
}

const stats: Stats = {
  total: 0,
  ingested: 0,
  deduped: 0,
  rejected: 0,
  byKind: {},
  bySource: {},
  events: [],
};

const seen = new Set<string>();

function dedupKey(e: PvsEvent): string {
  return `${e.clinicId}|${e.bridgeSource}|${e.pvsExternalEventId}|${e.occurredAt}`;
}

function verifySignature(raw: string, header: string | null): boolean {
  if (!header) return false;
  const m = header.match(/^sha256=([0-9a-f]+)$/i);
  if (!m) return false;
  const provided = Buffer.from(m[1]!, "hex");
  if (provided.length !== 32) return false;
  const expected = createHmac("sha256", TEST_CLINIC_SECRET)
    .update(raw)
    .digest();
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

function record(event: PvsEvent): "ingested" | "deduped" {
  const key = dedupKey(event);
  if (seen.has(key)) {
    stats.deduped += 1;
    stats.total += 1;
    return "deduped";
  }
  seen.add(key);
  stats.ingested += 1;
  stats.total += 1;
  stats.byKind[event.kind] = (stats.byKind[event.kind] ?? 0) + 1;
  stats.bySource[event.bridgeSource] =
    (stats.bySource[event.bridgeSource] ?? 0) + 1;
  stats.events.push({
    receivedAt: new Date().toISOString(),
    kind: event.kind,
    bridgeSource: event.bridgeSource,
    pvsExternalEventId: event.pvsExternalEventId,
    summary: summarise(event),
  });
  console.log(
    `  [stub-portal] ✓ ${event.bridgeSource.padEnd(10)} ${summarise(event)}`
  );
  return "ingested";
}

export async function startStubPortal(): Promise<{
  stop: () => Promise<void>;
  getStats: () => Stats;
  resetStats: () => void;
}> {
  const app = Fastify({ logger: false });

  // Capture raw body so signature verification is byte-identical to the
  // real portal, which reads request.text() before parsing JSON.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.post("/api/pvs/events", async (request, reply) => {
    const raw = request.body as string;
    const sig = request.headers["x-eins-signature"] as string | undefined;
    if (!verifySignature(raw, sig ?? null)) {
      stats.rejected += 1;
      console.warn(
        `  [stub-portal] ✗ bad signature (sig=${sig?.slice(0, 20) ?? "—"}…)`
      );
      reply.code(400);
      return { error: { code: "invalid_request" } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      stats.rejected += 1;
      reply.code(400);
      return { error: { code: "invalid_request" } };
    }
    const result = PvsEvent.safeParse(parsed);
    if (!result.success) {
      stats.rejected += 1;
      console.warn(
        `  [stub-portal] ✗ invalid envelope:`,
        result.error.issues.slice(0, 3)
      );
      reply.code(400);
      return {
        error: {
          code: "invalid_envelope",
          issues: result.error.issues.slice(0, 5),
        },
      };
    }
    if (result.data.clinicId !== TEST_CLINIC_ID) {
      stats.rejected += 1;
      reply.code(404);
      return { error: { code: "clinic_not_found" } };
    }
    const status = record(result.data);
    reply.code(201);
    return { ok: true, status, eventLogId: `stub-${stats.total}` };
  });

  app.post("/api/pvs/events/batch", async (request, reply) => {
    const raw = request.body as string;
    const sig = request.headers["x-eins-signature"] as string | undefined;
    if (!verifySignature(raw, sig ?? null)) {
      stats.rejected += 1;
      reply.code(400);
      return { error: { code: "invalid_request" } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      stats.rejected += 1;
      reply.code(400);
      return { error: { code: "invalid_request" } };
    }
    const batch = Batch.safeParse(parsed);
    if (!batch.success) {
      stats.rejected += 1;
      reply.code(400);
      return {
        error: {
          code: "invalid_envelope",
          issues: batch.error.issues.slice(0, 5),
        },
      };
    }
    if (batch.data.clinicId !== TEST_CLINIC_ID) {
      stats.rejected += 1;
      reply.code(404);
      return { error: { code: "clinic_not_found" } };
    }
    let ingested = 0;
    let deduped = 0;
    for (const event of batch.data.events) {
      if (event.clinicId !== batch.data.clinicId) {
        stats.rejected += 1;
        reply.code(400);
        return { error: { code: "clinic_mismatch" } };
      }
      const status = record(event);
      if (status === "ingested") ingested += 1;
      else deduped += 1;
    }
    reply.code(201);
    return { ok: true, ingested, deduped, errors: [] };
  });

  app.get("/__stats", async () => stats);
  app.post("/__reset", async () => {
    seen.clear();
    stats.total = 0;
    stats.ingested = 0;
    stats.deduped = 0;
    stats.rejected = 0;
    stats.byKind = {};
    stats.bySource = {};
    stats.events = [];
    return { ok: true };
  });

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ port: STUB_PORTAL_PORT, host: "127.0.0.1" });
  return {
    async stop() {
      await app.close();
    },
    getStats: () => structuredClone(stats),
    resetStats: () => {
      seen.clear();
      stats.total = 0;
      stats.ingested = 0;
      stats.deduped = 0;
      stats.rejected = 0;
      stats.byKind = {};
      stats.bySource = {};
      stats.events = [];
    },
  };
}

// Run directly: `tsx src/stub-portal.ts`
if (isMain(import.meta.url)) {
  banner("stub-portal");
  startStubPortal()
    .then(() => {
      console.log(
        `Stub portal listening on http://127.0.0.1:${STUB_PORTAL_PORT}`
      );
      console.log(`Clinic id:    ${TEST_CLINIC_ID}`);
      console.log(`HMAC secret:  ${TEST_CLINIC_SECRET.slice(0, 16)}…`);
      console.log(`GET /__stats  for accepted-event summary`);
    })
    .catch((err) => {
      console.error("[stub-portal] failed to start:", err);
      process.exit(1);
    });
}
