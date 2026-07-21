import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { db, schema } from "@/db/client";
import {
  evaluateHeartbeatHealth,
  healthSignature,
  reconcileAgentHealthAlerts,
  HEARTBEAT_SCOPE_KEYS,
  type AdapterStatusSnapshot,
  type AgentHeartbeatHealth,
} from "@/server/pvs-agent-health";

/**
 * PVS Bridge: GDT-Agent heartbeat ingest (P2-2).
 *
 * Producer: apps/bridge/agent emits a heartbeat every 60s with the
 * current dead-letter snapshot from its local SQLite outbox. The portal
 * upserts pvs_agent_status by clinicId so the admin clinic detail page
 * can render "agent healthy / N failed events / oldest failure X days
 * ago" without anyone touching the workstation.
 *
 * Security mirrors /api/pvs/events:
 *   1. Per-IP rate limit first (cheap rejection).
 *   2. JSON envelope parse + Zod schema check.
 *   3. Per-clinic rate limit (heartbeats are tight — 5/min/clinic is
 *      plenty for the 1/min producer cadence; anything higher is misbehaving).
 *   4. HMAC-SHA256 over the raw body against the per-clinic 'pvs' secret.
 *   5. Symmetric "invalid_request" failure so probes can't enumerate clinics.
 */

/**
 * Bridge-source enum, kept in lock-step with the canonical BRIDGE_SOURCES
 * (apps/bridge/src/canonical/schema-source.ts) and the portal Zod copies in
 * pvs-events.ts / pvs-health.ts. Local copy rather than an import because
 * pvs-events.ts pulls the pg-boss job module at load; this route only
 * needs the value set. The last 7 are the Phase 7 per-Praxis DB-read engines.
 */
const BridgeSourceEnum = z.enum([
  "tomedo",
  "healthhub",
  "red",
  "pabau",
  "consentz",
  "gdt_agent",
  "csv_upload",
  "n8n_custom",
  "medatixx",
  "cgm_albis",
  "cgm_turbomed",
  "cgm_m1pro",
  "indamed",
  "quincy",
  "pixelmedics",
]);

/**
 * A telemetry counter that can never reject the heartbeat.
 *
 * `.catch(0)` absorbs a NaN or a wrong type; the clamp keeps the value inside
 * a Postgres `integer` (and inside anything an operator would act on) without
 * a `.max()` that would 400 the whole envelope. A backlog past a million rows
 * is precisely the incident this endpoint exists to report, so refusing the
 * report over its size is the one behaviour we must not have.
 */
const clampedCount = z
  .number()
  .int()
  .nonnegative()
  .transform((n) => Math.min(n, 1_000_000));

/**
 * The same counter for REQUIRED fields, where we must produce a value and 0 is
 * the only sane one. Optional health counters must NOT use this: see
 * `preserveOnGarbage` for why degrading them to 0 is the bug, not the fix.
 */
const countField = clampedCount.catch(0);

/**
 * A telemetry string that truncates instead of rejecting. Same reasoning.
 * `fallback` is what a missing or wrong-typed value degrades to; identity-ish
 * fields pass a readable placeholder so the admin card does not render a blank.
 */
const textField = (max: number, fallback = "") =>
  z
    .string()
    .catch(fallback)
    .transform((s) => s.slice(0, max));

/**
 * Largest epoch-ms `new Date()` can represent. Anything past it yields an
 * Invalid Date, which then throws `RangeError` the moment the driver
 * serializes it, and the handler answers 500. The agent retries a 500 forever,
 * so an agent that ever reported a microsecond timestamp would be dark
 * permanently. Clamp instead.
 */
const MAX_EPOCH_MS = 8_640_000_000_000_000;

/** An epoch-ms field that can never produce an Invalid Date. */
const epochField = z
  .number()
  .int()
  .positive()
  .transform((n) => Math.min(n, MAX_EPOCH_MS));

/**
 * An OPTIONAL health field degrades to ABSENT, never to a healthy-looking
 * empty value.
 *
 * This is the same invariant the upsert relies on. If a wrong-typed
 * `dbAdaptersFailed` degraded to `""` and a wrong-typed `missingFolders` to
 * `[]`, the evaluator would read "no failure", the stored values would be
 * overwritten, and the live alert would be auto-resolved: a malformed payload
 * would silently recreate the exact blind spot this endpoint exists to close.
 * Degrading to `undefined` means "this heartbeat cannot report it", so the
 * stored value and the alert both survive untouched.
 */
const preserveOnGarbage = <T extends z.ZodTypeAny>(inner: T) =>
  inner.optional().catch(undefined);

/**
 * ENVELOPE POLICY: this schema rejects on IDENTITY, never on SIZE.
 *
 * clinicId and sentAt decide whether we can attribute and order the heartbeat
 * at all, so those stay strict. Everything else is telemetry, and every
 * size-based `.max()` on telemetry is a trap: the values that trip it (a
 * 10 000-char Oracle error chain, a million-row backlog) are exactly the
 * incidents this endpoint exists to report. Worse, the trigger value is
 * persistent, so a rejecting bound does not drop one heartbeat, it drops every
 * future one, and the agent's only complaint is a console warning rate-limited
 * to one line per ten minutes on a machine in a Praxis back office. The Praxis
 * would go from partially blind to fully dark at the exact moment something
 * broke. So: clamp and truncate, never reject.
 */
const HeartbeatSchema = z.object({
  clinicId: z.string().uuid(),
  agentVersion: textField(50),
  failedCount: countField,
  oldestFailedAt: epochField.nullable().catch(null),
  lastFailureReason: textField(500).nullable().catch(null),
  recentReasons: z
    .array(
      z.object({
        reason: textField(500),
        count: countField,
      })
    )
    .catch([])
    .transform((a) => a.slice(0, 20)),
  /**
   * Phase 7: the bridge_sources this agent currently runs (db-adapter vendors
   * via bridgeSourceForVendor, plus gdt_agent when a watchFolder is set). The
   * portal upserts each into pvs_link_source so the clinic is allowed to emit
   * them. Optional + back-compat: an older agent that omits it keeps working
   * (its events still match via the fast path or the 0055 backfill row).
   *
   * Unknown entries are DROPPED, they do not reject the heartbeat. Version
   * skew makes that reachable: roll an agent that knows a new vendor out
   * before the portal migration that widens this enum and, with a rejecting
   * bound, every heartbeat from that Praxis 400s forever, taking the backlog
   * and failure telemetry down with it. Dropping keeps the known sources
   * enrolling and loses only the one value the portal cannot store anyway
   * (pvs_link_source.bridge_source has its own CHECK constraint, so an
   * unknown value could never be written regardless).
   */
  enrolledVendors: z
    .array(BridgeSourceEnum.nullable().catch(null))
    .catch([])
    .transform((a) =>
      a.filter((v): v is z.infer<typeof BridgeSourceEnum> => v !== null).slice(0, 20)
    )
    .optional(),
  sentAt: epochField,

  /**
   * 0069: operational-health fields. The agent has emitted these since the
   * H10c/H13/M-A2/M-D4 work; this envelope used to omit them, and Zod's
   * default object mode strips unknown keys silently, so they were parsed
   * and thrown away with a 200 ok.
   *
   * They matter because `failedCount` is a DEAD-LETTER counter. A moved
   * export folder, a runner that never started, a halted stream and a
   * forever-retrying outbox all report failedCount = 0 while delivering
   * zero events, which is indistinguishable from a quiet week at the Praxis.
   *
   * All optional: an older agent that omits them keeps working, and the
   * upsert below leaves the stored values untouched rather than resetting
   * them to a healthy-looking zero.
   */
  pendingCount: preserveOnGarbage(clampedCount),
  oldestPendingAt: preserveOnGarbage(epochField.nullable()),
  stalePendingCount: preserveOnGarbage(clampedCount),
  missingFolders: preserveOnGarbage(
    z.array(textField(500)).transform((a) => a.slice(0, 50))
  ),
  dbAdaptersFailed: preserveOnGarbage(
    // Deliberately NOT textField: its "" fallback would read as "no failure"
    // to the evaluator and auto-resolve a live alert.
    z
      .string()
      .transform((s) => s.slice(0, 2_000))
      .nullable()
  ),
  adapterStatuses: preserveOnGarbage(
    z
      .array(
        z.object({
          vendor: textField(100, "unbekannt"),
          stream: textField(100, "unbekannt"),
          status: textField(50, "unbekannt"),
          lastError: textField(1_000).nullable().catch(null).default(null),
          connectError: textField(1_000).nullable().catch(null).default(null),
          consecutiveFailures: countField.optional(),
          lastRunAt: z
            .number()
            .int()
            .nonnegative()
            .nullable()
            .catch(null)
            .optional(),
        })
      )
      .transform((a) => a.slice(0, 200))
  ),
});

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const sig = request.headers.get("x-eins-signature");

  const ipRaw =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const requestMeta = {
    ip: ipRaw.split(",")[0]?.trim() || null,
    ua: request.headers.get("user-agent") ?? null,
  };

  // Per-IP gate first (P1-4 pattern).
  if (requestMeta.ip) {
    const ipRl = await rateLimit("pvs-agent-hb-ip", requestMeta.ip, {
      limit: 300,
      windowSeconds: 60,
    });
    if (!ipRl.ok) {
      return NextResponse.json(
        { error: { code: "rate_limited" } },
        {
          status: 429,
          headers: {
            "Retry-After": String(ipRl.resetInSeconds),
            "X-PVS-RateLimit-Reason": "ip",
          },
        }
      );
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return genericFail();
  }

  const parseResult = HeartbeatSchema.safeParse(parsed);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_envelope",
          issues: parseResult.error.issues.slice(0, 5),
        },
      },
      { status: 400 }
    );
  }
  const event = parseResult.data;

  // Per-clinic budget: the producer cadence is 1/min; 5/min gives
  // headroom for cold-start fast retries without enabling abuse.
  const rl = await rateLimit("pvs-agent-hb", event.clinicId, {
    limit: 5,
    windowSeconds: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.resetInSeconds),
          "X-PVS-RateLimit-Reason": "clinic",
        },
      }
    );
  }

  const sigOk = await verifyClinicSignature(event.clinicId, raw, sig, "pvs");
  if (!sigOk) {
    after(() =>
      writeAudit({
        clinicId: event.clinicId,
        action: "pvs_agent_heartbeat_reject",
        entityKind: "pvs_agent_status",
        diff: { reason: "bad_signature" },
        requestMeta,
      })
    );
    return genericFail();
  }

  try {
    const oldestFailedAt = event.oldestFailedAt
      ? new Date(event.oldestFailedAt)
      : null;

    // 0069: read the stored health slice first, for two reasons. It lets an
    // older agent that omits the health fields keep its last known values
    // instead of having them reset to a healthy-looking zero, and it lets us
    // skip the alert reconcile entirely while nothing has changed (the steady
    // state is one heartbeat per clinic per minute, forever).
    const [prior] = await db
      .select({
        stalePendingEvents: schema.pvsAgentStatus.stalePendingEvents,
        missingFolders: schema.pvsAgentStatus.missingFolders,
        dbAdaptersFailed: schema.pvsAgentStatus.dbAdaptersFailed,
        adapterStatuses: schema.pvsAgentStatus.adapterStatuses,
      })
      .from(schema.pvsAgentStatus)
      .where(eq(schema.pvsAgentStatus.clinicId, event.clinicId))
      .limit(1);

    const priorHealth: AgentHeartbeatHealth = {
      stalePendingEvents: prior?.stalePendingEvents ?? 0,
      missingFolders: (prior?.missingFolders as string[] | undefined) ?? [],
      dbAdaptersFailed: prior?.dbAdaptersFailed ?? null,
      adapterStatuses:
        (prior?.adapterStatuses as AdapterStatusSnapshot[] | undefined) ?? [],
    };
    // Absent field == "this agent build cannot report it", NOT "all clear".
    const nextHealth: AgentHeartbeatHealth = {
      stalePendingEvents:
        event.stalePendingCount ?? priorHealth.stalePendingEvents,
      missingFolders: event.missingFolders ?? priorHealth.missingFolders,
      dbAdaptersFailed:
        event.dbAdaptersFailed !== undefined
          ? event.dbAdaptersFailed
          : priorHealth.dbAdaptersFailed,
      adapterStatuses: event.adapterStatuses ?? priorHealth.adapterStatuses,
    };

    const healthValues = {
      ...(event.pendingCount !== undefined
        ? { pendingEvents: event.pendingCount }
        : {}),
      ...(event.stalePendingCount !== undefined
        ? { stalePendingEvents: event.stalePendingCount }
        : {}),
      ...(event.oldestPendingAt !== undefined
        ? {
            oldestPendingAt: event.oldestPendingAt
              ? new Date(event.oldestPendingAt)
              : null,
          }
        : {}),
      ...(event.missingFolders !== undefined
        ? {
            missingFolders: event.missingFolders as unknown as Record<
              string,
              unknown
            >,
          }
        : {}),
      ...(event.dbAdaptersFailed !== undefined
        ? { dbAdaptersFailed: event.dbAdaptersFailed }
        : {}),
      ...(event.adapterStatuses !== undefined
        ? {
            adapterStatuses: event.adapterStatuses as unknown as Record<
              string,
              unknown
            >,
          }
        : {}),
    };

    await db
      .insert(schema.pvsAgentStatus)
      .values({
        clinicId: event.clinicId,
        agentVersion: event.agentVersion,
        lastHeartbeatAt: new Date(event.sentAt),
        failedEvents: event.failedCount,
        oldestFailedAt,
        lastFailureReason: event.lastFailureReason,
        recentReasons: event.recentReasons as unknown as Record<string, unknown>,
        ...healthValues,
      })
      .onConflictDoUpdate({
        target: schema.pvsAgentStatus.clinicId,
        set: {
          agentVersion: event.agentVersion,
          lastHeartbeatAt: new Date(event.sentAt),
          failedEvents: event.failedCount,
          oldestFailedAt,
          lastFailureReason: event.lastFailureReason,
          recentReasons:
            event.recentReasons as unknown as Record<string, unknown>,
          ...healthValues,
        },
      });

    // 0069: raise/resolve the heartbeat-derived health alerts, but only when
    // the health picture actually changed. `after()` keeps the alert writes
    // off the response path: a failed alert write must never fail a heartbeat.
    if (
      prior === undefined ||
      healthSignature(priorHealth) !== healthSignature(nextHealth)
    ) {
      after(() =>
        reconcileAgentHealthAlerts(
          event.clinicId,
          evaluateHeartbeatHealth(nextHealth),
          HEARTBEAT_SCOPE_KEYS
        ).catch((err) =>
          // Swallowed on purpose: a failed alert write must never turn a
          // healthy heartbeat into an error the agent will retry forever.
          console.error(
            `[pvs-agent-heartbeat] alert reconcile failed (clinic=${event.clinicId}):`,
            err
          )
        )
      );
    }

    // Phase 7: record the bridge_sources this agent runs so the clinic is
    // allowed to emit them (pvs_link_source membership). One batched upsert;
    // pvs_vendor == bridge_source for the DB-read engines and gdt_agent. Skip
    // entirely when the agent didn't report any (older agent, or no adapters
    // enabled yet) so the common heartbeat stays a single write.
    if (event.enrolledVendors && event.enrolledVendors.length > 0) {
      const seenAt = new Date(event.sentAt);
      // Dedupe within the payload so the batch insert can't self-conflict on
      // its own (clinic_id, bridge_source) PK in one statement.
      const sources = Array.from(new Set(event.enrolledVendors));
      await db
        .insert(schema.pvsLinkSource)
        .values(
          sources.map((src) => ({
            clinicId: event.clinicId,
            bridgeSource: src,
            pvsVendor: src,
            enrolledVia: "heartbeat",
            lastSeenAt: seenAt,
          }))
        )
        .onConflictDoUpdate({
          target: [
            schema.pvsLinkSource.clinicId,
            schema.pvsLinkSource.bridgeSource,
          ],
          set: {
            lastSeenAt: seenAt,
            pvsVendor: sql`excluded.pvs_vendor`,
            enrolledVia: sql`excluded.enrolled_via`,
          },
        });
    }

    // P2-2: alert threshold. The dashboard renders the count itself,
    // but failedCount > 100 deserves a flagged audit row so an operator
    // grepping the audit log can find "when did this go bad" without
    // joining against a time-series of heartbeats.
    if (event.failedCount > 100) {
      after(() =>
        writeAudit({
          clinicId: event.clinicId,
          action: "pvs_agent_dead_letter_alert",
          entityKind: "pvs_agent_status",
          diff: {
            failedCount: event.failedCount,
            oldestFailedAt: event.oldestFailedAt,
            lastFailureReason: event.lastFailureReason,
          },
          requestMeta,
        })
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[pvs-agent-heartbeat] handler failed:", err);
    return NextResponse.json(
      { error: { code: "internal" } },
      { status: 500 }
    );
  }
}

function genericFail(): NextResponse {
  return NextResponse.json(
    { error: { code: "invalid_request" } },
    { status: 400 }
  );
}
