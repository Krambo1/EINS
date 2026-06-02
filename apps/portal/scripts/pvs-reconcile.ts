/**
 * pvs-reconcile — operator CLI for un-linking, recomputing, and replaying
 * PVS Bridge state when things go sideways.
 *
 * Plan ref: PVS Bridge Hardening — P2-1.
 *
 * Subcommands (all dry-run unless --apply is passed):
 *
 *   unlink --clinic-id X --pvs-patient-id Y --portal-patient-id Z \
 *          --reason "<text>" [--apply]
 *     Delete the pvs_patient_map row for (clinic, pvs-id, portal-id),
 *     mark every pvs_event_log row tied to that pvs-id needs_rederive=true,
 *     and enqueue a derive replay for the affected timeframe.
 *
 *   recompute-lifetime --clinic-id X [--apply]
 *     For every patient in the clinic, re-enqueue pvs-status-derive so
 *     lifetime_revenue_eur is recomputed from the canonical event log.
 *     Idempotent — derive's BullMQ jobId coalesces concurrent enqueues.
 *
 *   replay-events --clinic-id X --from YYYY-MM-DD --to YYYY-MM-DD \
 *                 [--include-applied] [--apply]
 *     Re-enqueue derive for every (clinic, patient) tuple whose event-log
 *     rows in [from, to) need rederive (or, with --include-applied, every
 *     tuple in the window regardless). Clears needs_rederive on enqueue.
 *
 *   show-link-failures --clinic-id X [--limit N]
 *     Read-only — lists open linking_failures rows so the operator can
 *     decide whether to manual-resolve in the portal UI or run unlink+
 *     replay here.
 *
 * Audit: every applied subcommand writes a pvs_reconcile_audit row with
 * before+after snapshots of the affected rows (capped at 200 rows of
 * detail each to bound storage). Dry-runs are also recorded so an
 * operator's "I ran dry-run and then applied" trail is reviewable.
 *
 * Usage (PowerShell — see CLAUDE.md gotchas):
 *   pnpm --filter portal tsx scripts/pvs-reconcile.ts unlink \
 *     --clinic-id 41a4… --pvs-patient-id 31729 --portal-patient-id 8b2c… \
 *     --reason "wrong-fuzzy-match: phone-only collision" --apply
 */

// MUST be first: neutralizes the `server-only` throw before any module that
// imports it (transitively via ../src/db/client → server modules) evaluates
// under plain tsx. See ../src/worker/shim-server-only.ts.
import "../src/worker/shim-server-only";

import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "../src/db/client";
import {
  enqueueKpiRebuild,
  enqueuePvsStatusDerive,
} from "../src/server/jobs";

// ---------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  const v = args[i + 1];
  if (v.startsWith("--")) return undefined;
  return v;
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function requireFlag(args: string[], name: string): string {
  const v = flag(args, name);
  if (!v) {
    console.error(`error: missing required ${name}`);
    process.exit(2);
  }
  return v;
}

function actorFromEnv(): string {
  // Captured into the audit row so a future operator can see who ran
  // what. The CLI runs without a portal-session identity, so this is
  // the best we have without rolling a separate auth flow.
  return (
    process.env.PVS_RECONCILE_ACTOR ||
    process.env.USER ||
    process.env.USERNAME ||
    "unknown"
  );
}

// ---------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------

interface AuditArgs {
  clinicId: string;
  kind: "unlink" | "recompute_lifetime" | "replay_events" | "manual_repair";
  reason: string | null;
  before: unknown;
  after: unknown;
  dryRun: boolean;
}

/**
 * Cap the JSON snapshots so a runaway invocation can't bloat the audit
 * table. Practical experience: an operator who replays 30 days of events
 * for a big clinic can touch tens of thousands of rows; recording each
 * id is fine, but recording full row payloads gets expensive fast.
 */
const SNAPSHOT_ROW_CAP = 200;

function capSnapshot(snap: unknown): unknown {
  if (Array.isArray(snap)) {
    if (snap.length <= SNAPSHOT_ROW_CAP) return snap;
    return { truncated: true, totalRows: snap.length, sample: snap.slice(0, SNAPSHOT_ROW_CAP) };
  }
  return snap;
}

async function writeAuditRow(args: AuditArgs): Promise<void> {
  try {
    await db.insert(schema.pvsReconcileAudit).values({
      clinicId: args.clinicId,
      kind: args.kind,
      actor: actorFromEnv(),
      reason: args.reason,
      beforeState: capSnapshot(args.before) as Record<string, unknown>,
      afterState: capSnapshot(args.after) as Record<string, unknown>,
      dryRun: args.dryRun,
    });
  } catch (err) {
    // Audit-write failure must not silently swallow the action above.
    // We log loudly and re-throw so the operator notices and investigates.
    console.error("[pvs-reconcile] FAILED to write audit row:", err);
    throw err;
  }
}

// ---------------------------------------------------------------
// Subcommand: unlink
// ---------------------------------------------------------------

interface UnlinkArgs {
  clinicId: string;
  pvsPatientId: string;
  portalPatientId: string;
  reason: string;
  apply: boolean;
}

async function runUnlink(args: UnlinkArgs): Promise<void> {
  // 1) Resolve the map row.
  const [mapRow] = await db
    .select({
      id: schema.pvsPatientMap.id,
      linkMethod: schema.pvsPatientMap.linkMethod,
      confidenceScore: schema.pvsPatientMap.confidenceScore,
      linkedAt: schema.pvsPatientMap.linkedAt,
      linkedBy: schema.pvsPatientMap.linkedBy,
    })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, args.clinicId),
        eq(schema.pvsPatientMap.pvsPatientId, args.pvsPatientId),
        eq(schema.pvsPatientMap.portalPatientId, args.portalPatientId)
      )
    )
    .limit(1);

  if (!mapRow) {
    console.error(
      `error: no pvs_patient_map row for (clinic=${args.clinicId}, pvs=${args.pvsPatientId}, portal=${args.portalPatientId})`
    );
    process.exit(1);
  }

  // 2) Find every pvs_event_log row tied to this pvs patient id, so the
  //    operator can see what derive will re-process after the unlink.
  //
  //    The ::text[] cast on the param is non-negotiable (see
  //    pvs-status-derive.ts:118 for the postgres.js binding rationale).
  const events = await db
    .select({
      id: schema.pvsEventLog.id,
      kind: schema.pvsEventLog.kind,
      occurredAt: schema.pvsEventLog.occurredAt,
      appliedAt: schema.pvsEventLog.appliedAt,
      needsRederive: schema.pvsEventLog.needsRederive,
    })
    .from(schema.pvsEventLog)
    .where(
      and(
        eq(schema.pvsEventLog.clinicId, args.clinicId),
        sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ${args.pvsPatientId}`
      )
    )
    .orderBy(asc(schema.pvsEventLog.occurredAt));

  const minOccurred = events[0]?.occurredAt ?? null;
  const maxOccurred = events[events.length - 1]?.occurredAt ?? null;

  console.log("");
  console.log(`unlink (${args.apply ? "APPLY" : "dry-run"}):`);
  console.log(`  clinic:           ${args.clinicId}`);
  console.log(`  pvs_patient_id:   ${args.pvsPatientId}`);
  console.log(`  portal_patient:   ${args.portalPatientId}`);
  console.log(
    `  current link:     method=${mapRow.linkMethod} score=${mapRow.confidenceScore ?? "—"} linked_at=${mapRow.linkedAt.toISOString()}`
  );
  console.log(`  event-log rows:   ${events.length}`);
  if (minOccurred && maxOccurred) {
    console.log(
      `  window:           ${minOccurred.toISOString().slice(0, 10)} → ${maxOccurred.toISOString().slice(0, 10)}`
    );
  }
  console.log(`  reason:           ${args.reason}`);

  const beforeSnapshot = {
    pvsPatientMap: mapRow,
    eventLogIds: events.map((e) => e.id),
    eventCount: events.length,
    occurredRange: {
      from: minOccurred?.toISOString() ?? null,
      to: maxOccurred?.toISOString() ?? null,
    },
  };

  if (!args.apply) {
    console.log("\ndry-run: no changes written. Pass --apply to commit.");
    await writeAuditRow({
      clinicId: args.clinicId,
      kind: "unlink",
      reason: args.reason,
      before: beforeSnapshot,
      after: { wouldAffectEventCount: events.length },
      dryRun: true,
    });
    return;
  }

  // 3) Apply, all-in-one transaction so a downstream failure (e.g. the
  //    needs_rederive update) doesn't leave the map row deleted but the
  //    derive replay un-flagged. Audit row also lives in the same tx so
  //    a partial commit can't produce a write without a trail.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.pvsPatientMap)
      .where(eq(schema.pvsPatientMap.id, mapRow.id));

    if (events.length > 0) {
      await tx
        .update(schema.pvsEventLog)
        .set({ needsRederive: true })
        .where(
          and(
            eq(schema.pvsEventLog.clinicId, args.clinicId),
            sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ${args.pvsPatientId}`
          )
        );
    }

    await tx.insert(schema.pvsReconcileAudit).values({
      clinicId: args.clinicId,
      kind: "unlink",
      actor: actorFromEnv(),
      reason: args.reason,
      beforeState: capSnapshot(beforeSnapshot) as Record<string, unknown>,
      afterState: capSnapshot({
        deletedMapRowId: mapRow.id,
        flaggedRederive: events.length,
      }) as Record<string, unknown>,
      dryRun: false,
    });
  });

  // 4) Enqueue derive replay for the affected timeframe so request rows
  //    revert to their pre-link state (revenue moves off the wrong
  //    patient; ads-conversion outbox does NOT recall already-sent
  //    purchases — that requires a separate channel call documented in
  //    docs/runbooks/pvs-bridge.md).
  await enqueuePvsStatusDerive(args.clinicId, args.portalPatientId);

  if (minOccurred && maxOccurred) {
    const fromISO = minOccurred.toISOString().slice(0, 10);
    const toISO = maxOccurred.toISOString().slice(0, 10);
    await enqueueKpiRebuild(args.clinicId, fromISO, toISO);
  }

  console.log(
    `\napplied. map row deleted; ${events.length} event-log rows flagged needs_rederive=true; derive + kpi-rebuild enqueued.`
  );
}

// ---------------------------------------------------------------
// Subcommand: recompute-lifetime
// ---------------------------------------------------------------

interface RecomputeArgs {
  clinicId: string;
  apply: boolean;
}

async function runRecomputeLifetime(args: RecomputeArgs): Promise<void> {
  // Enumerate every distinct portal_patient_id with at least one PVS
  // mapping in the clinic. That's the set whose lifetime_revenue_eur
  // can change as a function of pvs_event_log content. Patients with
  // no PVS link have lifetime_revenue from manual revenue entry only,
  // and we don't touch those.
  const rows = await db
    .select({
      portalPatientId: schema.pvsPatientMap.portalPatientId,
    })
    .from(schema.pvsPatientMap)
    .where(eq(schema.pvsPatientMap.clinicId, args.clinicId))
    .groupBy(schema.pvsPatientMap.portalPatientId);

  console.log("");
  console.log(`recompute-lifetime (${args.apply ? "APPLY" : "dry-run"}):`);
  console.log(`  clinic:        ${args.clinicId}`);
  console.log(`  patients:      ${rows.length}`);

  if (!args.apply) {
    console.log("\ndry-run: no enqueue. Pass --apply to fan out derive jobs.");
    await writeAuditRow({
      clinicId: args.clinicId,
      kind: "recompute_lifetime",
      reason: null,
      before: { patientCount: rows.length },
      after: { wouldEnqueue: rows.length },
      dryRun: true,
    });
    return;
  }

  let enqueued = 0;
  for (const row of rows) {
    const id = await enqueuePvsStatusDerive(args.clinicId, row.portalPatientId);
    if (id) enqueued += 1;
  }

  await writeAuditRow({
    clinicId: args.clinicId,
    kind: "recompute_lifetime",
    reason: null,
    before: { patientCount: rows.length },
    after: { enqueued },
    dryRun: false,
  });

  console.log(`\napplied. Enqueued ${enqueued} derive jobs.`);
}

// ---------------------------------------------------------------
// Subcommand: replay-events
// ---------------------------------------------------------------

interface ReplayArgs {
  clinicId: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD (exclusive)
  includeApplied: boolean;
  apply: boolean;
}

async function runReplayEvents(args: ReplayArgs): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(args.toDate)) {
    console.error("error: --from / --to must be YYYY-MM-DD");
    process.exit(2);
  }
  const from = new Date(`${args.fromDate}T00:00:00Z`);
  const to = new Date(`${args.toDate}T00:00:00Z`);
  if (to <= from) {
    console.error("error: --to must be strictly after --from");
    process.exit(2);
  }

  // Identify rows in the window that need rederive (or, with
  // --include-applied, any row in the window). We then group by
  // (clinic, portal_patient) via the patient map so we can dedupe the
  // derive enqueue — a clinic with 500 InvoicePaid events spread over
  // 30 days for 50 patients should fan out 50 derive jobs, not 500.
  const baseWhere = args.includeApplied
    ? and(
        eq(schema.pvsEventLog.clinicId, args.clinicId),
        gte(schema.pvsEventLog.occurredAt, from),
        lt(schema.pvsEventLog.occurredAt, to)
      )
    : and(
        eq(schema.pvsEventLog.clinicId, args.clinicId),
        gte(schema.pvsEventLog.occurredAt, from),
        lt(schema.pvsEventLog.occurredAt, to),
        eq(schema.pvsEventLog.needsRederive, true)
      );

  const candidates = await db
    .select({
      id: schema.pvsEventLog.id,
      pvsPatientId: sql<string>`${schema.pvsEventLog.payload}->>'pvsPatientId'`,
      occurredAt: schema.pvsEventLog.occurredAt,
    })
    .from(schema.pvsEventLog)
    .where(baseWhere);

  const pvsIds = Array.from(
    new Set(candidates.map((r) => r.pvsPatientId).filter((x): x is string => !!x))
  );

  // Resolve pvs_patient_id → portal_patient_id via the current map (post-
  // unlink, if the operator just ran one).
  const mapRows = pvsIds.length
    ? await db
        .select({
          pvsPatientId: schema.pvsPatientMap.pvsPatientId,
          portalPatientId: schema.pvsPatientMap.portalPatientId,
        })
        .from(schema.pvsPatientMap)
        .where(
          and(
            eq(schema.pvsPatientMap.clinicId, args.clinicId),
            sql`${schema.pvsPatientMap.pvsPatientId} = ANY(${pvsIds}::text[])`
          )
        )
    : [];
  const pvsToPortal = new Map(mapRows.map((r) => [r.pvsPatientId, r.portalPatientId]));
  const portalIds = Array.from(new Set(mapRows.map((r) => r.portalPatientId)));
  const orphanCount = pvsIds.length - mapRows.length;

  console.log("");
  console.log(`replay-events (${args.apply ? "APPLY" : "dry-run"}):`);
  console.log(`  clinic:           ${args.clinicId}`);
  console.log(`  window:           ${args.fromDate} → ${args.toDate} (exclusive)`);
  console.log(`  events in window: ${candidates.length}`);
  console.log(`  pvs patients:     ${pvsIds.length}`);
  console.log(`  portal patients:  ${portalIds.length}`);
  if (orphanCount > 0) {
    console.log(
      `  orphans:          ${orphanCount} (no pvs_patient_map row — will route to linking_failures via the linker on next ingest)`
    );
  }
  console.log(
    `  filter:           ${args.includeApplied ? "any row in window" : "needs_rederive=true only"}`
  );

  const before = {
    candidateCount: candidates.length,
    pvsPatientIds: pvsIds.slice(0, 50),
    portalPatientIds: portalIds.slice(0, 50),
    orphanCount,
  };

  if (!args.apply) {
    console.log("\ndry-run: no enqueue, no clear. Pass --apply.");
    await writeAuditRow({
      clinicId: args.clinicId,
      kind: "replay_events",
      reason: `window=${args.fromDate}..${args.toDate} include_applied=${args.includeApplied}`,
      before,
      after: { wouldEnqueue: portalIds.length },
      dryRun: true,
    });
    return;
  }

  // Apply: enqueue per portal patient, then clear needs_rederive on the
  // rows we just enqueued for. Order matters — we clear AFTER enqueue
  // succeeds so a Redis hiccup mid-replay leaves the flag set for the
  // next operator run.
  let enqueued = 0;
  for (const portalPatientId of portalIds) {
    const id = await enqueuePvsStatusDerive(args.clinicId, portalPatientId);
    if (id) enqueued += 1;
  }

  // KPI rebuild for the day range covered by the events we just replayed.
  await enqueueKpiRebuild(args.clinicId, args.fromDate, args.toDate);

  // Clear the rederive flag (only the rows we actually replayed via a
  // mapped patient — orphans stay flagged so they're re-attempted after
  // the linker resolves them).
  const replayedEventIds = candidates
    .filter((r) => r.pvsPatientId && pvsToPortal.has(r.pvsPatientId))
    .map((r) => r.id);
  if (replayedEventIds.length > 0 && !args.includeApplied) {
    // We only clear when filter was "needs_rederive=true" — if the
    // operator passed --include-applied they may want the flag preserved
    // for a follow-up bulk re-run.
    //
    // Note: in postgres.js with this driver wrapping, `sql.placeholder` /
    // ANY() syntax handles the array binding through the ::uuid[] cast.
    await db
      .update(schema.pvsEventLog)
      .set({ needsRederive: false })
      .where(
        and(
          eq(schema.pvsEventLog.clinicId, args.clinicId),
          sql`${schema.pvsEventLog.id} = ANY(${replayedEventIds}::uuid[])`
        )
      );
  }

  await writeAuditRow({
    clinicId: args.clinicId,
    kind: "replay_events",
    reason: `window=${args.fromDate}..${args.toDate} include_applied=${args.includeApplied}`,
    before,
    after: {
      enqueued,
      clearedRederiveFlags: args.includeApplied ? 0 : replayedEventIds.length,
      orphanCount,
    },
    dryRun: false,
  });

  console.log(
    `\napplied. ${enqueued} derive jobs enqueued; kpi-rebuild enqueued for the window; ${
      args.includeApplied ? 0 : replayedEventIds.length
    } needs_rederive flags cleared.`
  );
}

// ---------------------------------------------------------------
// Subcommand: show-link-failures
// ---------------------------------------------------------------

interface ShowFailuresArgs {
  clinicId: string;
  limit: number;
}

async function runShowLinkFailures(args: ShowFailuresArgs): Promise<void> {
  const rows = await db
    .select({
      id: schema.linkingFailures.id,
      pvsPatientId: schema.linkingFailures.pvsPatientId,
      pvsEventOccurredAt: schema.linkingFailures.pvsEventOccurredAt,
      snapshot: schema.linkingFailures.pvsPatientSnapshot,
      candidates: schema.linkingFailures.candidates,
      createdAt: schema.linkingFailures.createdAt,
    })
    .from(schema.linkingFailures)
    .where(
      and(
        eq(schema.linkingFailures.clinicId, args.clinicId),
        eq(schema.linkingFailures.status, "open")
      )
    )
    .orderBy(asc(schema.linkingFailures.createdAt))
    .limit(args.limit);

  console.log("");
  console.log(`show-link-failures (read-only):`);
  console.log(`  clinic:    ${args.clinicId}`);
  console.log(`  open rows: ${rows.length}${rows.length === args.limit ? " (capped — pass --limit higher)" : ""}`);
  console.log("");

  if (rows.length === 0) {
    console.log("  No open linking-failure rows. Inbox is clean.");
    return;
  }

  for (const r of rows) {
    const snap = (r.snapshot ?? {}) as Record<string, unknown>;
    const cands = (r.candidates as Array<{ patientId?: string; score?: number; method?: string }> | null) ?? [];
    console.log(`  [${r.id.slice(0, 8)}]  pvs=${r.pvsPatientId}  occurred=${r.pvsEventOccurredAt.toISOString()}`);
    console.log(
      `         name=${snap.fullName ?? "—"}  email=${snap.email ?? "—"}  dob=${snap.dob ?? "—"}  phone=${snap.phone ?? "—"}`
    );
    if (cands.length === 0) {
      console.log(`         no candidates`);
    } else {
      for (const c of cands.slice(0, 3)) {
        console.log(
          `         candidate: patientId=${(c.patientId ?? "—").slice(0, 8)}  score=${c.score ?? "—"}  via=${c.method ?? "—"}`
        );
      }
    }
    console.log("");
  }
}

// ---------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------

function printUsage(): void {
  console.log(`pvs-reconcile — operator CLI

Usage:
  unlink             --clinic-id X --pvs-patient-id Y --portal-patient-id Z --reason "..." [--apply]
  recompute-lifetime --clinic-id X [--apply]
  replay-events      --clinic-id X --from YYYY-MM-DD --to YYYY-MM-DD [--include-applied] [--apply]
  show-link-failures --clinic-id X [--limit N]

All write subcommands are DRY-RUN by default. Pass --apply to commit.
Audit rows are written to pvs_reconcile_audit for every invocation (dry-run + apply).`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printUsage();
    process.exit(0);
  }

  const args = argv.slice(1);

  try {
    if (subcommand === "unlink") {
      const reasonRaw = requireFlag(args, "--reason");
      if (reasonRaw.length > 500) {
        console.error("error: --reason capped at 500 chars");
        process.exit(2);
      }
      await runUnlink({
        clinicId: requireFlag(args, "--clinic-id"),
        pvsPatientId: requireFlag(args, "--pvs-patient-id"),
        portalPatientId: requireFlag(args, "--portal-patient-id"),
        reason: reasonRaw,
        apply: boolFlag(args, "--apply"),
      });
    } else if (subcommand === "recompute-lifetime") {
      await runRecomputeLifetime({
        clinicId: requireFlag(args, "--clinic-id"),
        apply: boolFlag(args, "--apply"),
      });
    } else if (subcommand === "replay-events") {
      await runReplayEvents({
        clinicId: requireFlag(args, "--clinic-id"),
        fromDate: requireFlag(args, "--from"),
        toDate: requireFlag(args, "--to"),
        includeApplied: boolFlag(args, "--include-applied"),
        apply: boolFlag(args, "--apply"),
      });
    } else if (subcommand === "show-link-failures") {
      const limitRaw = flag(args, "--limit");
      const limit = Math.max(1, Math.min(500, Number(limitRaw ?? 50) || 50));
      await runShowLinkFailures({
        clinicId: requireFlag(args, "--clinic-id"),
        limit,
      });
    } else {
      console.error(`unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(2);
    }
  } catch (err) {
    console.error("[pvs-reconcile] fatal:", err);
    process.exit(1);
  }
  process.exit(0);
}

main();
