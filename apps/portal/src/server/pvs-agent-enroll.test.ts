import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Logic-level tests for redeemAgentEnrollment.
 *
 * These do NOT spin up a postgres; they stub `@/db/client` to make the
 * transaction boundary visible to the test. The goal is to nail down the
 * P0-1 contract — that a partial failure inside the tx never strands a
 * freshly-minted secret while leaving the token un-consumed. A full DB
 * integration test belongs in CI against a real ephemeral pg; this file
 * catches the control-flow regressions cheaply.
 */

// ---- Mocks -------------------------------------------------------------

// State the mock db reads/writes per-test.
interface MockTokenRow {
  id: string;
  clinicId: string;
  tokenHash: string;
  expectedFingerprint: string | null;
  consumedAt: Date | null;
  expiresAt: Date;
  allowVendorSwitch: boolean;
}

interface MockPvsLink {
  clinicId: string;
  vendor: string;
  status: string;
}

interface MockAuditRow {
  clinicId: string;
  kind: string;
  fromValue: string | null;
  toValue: string | null;
  context: Record<string, unknown>;
}

interface MockState {
  tokens: MockTokenRow[];
  // Existing pvs_link rows used by the vendor-switch pre-check.
  existingLinks: MockPvsLink[];
  pvsCredentials: Array<{ clinicId: string; platform: string; ciphertext: Buffer }>;
  pvsLinks: MockPvsLink[];
  auditRows: MockAuditRow[];
  cacheInvalidations: Array<{ clinicId: string; platform: string }>;
  // Hook to inject a failure at the "upsert pvs_link" step. Set to a
  // function that returns or throws to control behaviour mid-tx.
  failOnLinkUpsert: null | (() => never);
  // Records the order operations execute so assertions can verify the
  // transaction body sequence (claim → mint → link upsert).
  trace: string[];
  // Set to true to force the conditional token-claim UPDATE to return zero
  // rows — simulates a concurrent redemption winning the race.
  raceClaimEmpty: boolean;
  // Whether the tx is currently open (for ordering assertions).
  txOpen: boolean;
  // Whether the tx committed or rolled back at the end.
  txOutcome: "committed" | "rolled_back" | null;
}

let state: MockState;

function freshState(): MockState {
  return {
    tokens: [],
    existingLinks: [],
    pvsCredentials: [],
    pvsLinks: [],
    auditRows: [],
    cacheInvalidations: [],
    failOnLinkUpsert: null,
    trace: [],
    raceClaimEmpty: false,
    txOpen: false,
    txOutcome: null,
  };
}

// Build a fake Drizzle-shaped chainable. We only stub the methods this
// module actually uses; calling something else throws so the test catches
// drift between mock and real call surface.

function buildDbHandle(isTx: boolean) {
  const handle = {
    select: (cols: unknown) => buildSelect(cols, isTx),
    // The real Drizzle types pass full pgTable objects in; in this mock we
    // only care about the `__tag` sentinel we attach in the schema mock.
    // Accept `unknown` and narrow inside the builders.
    insert: (table: unknown) =>
      buildInsert(table as { __tag?: string }, isTx),
    update: (table: unknown) =>
      buildUpdate(table as { __tag?: string }, isTx),
    transaction: async <T,>(
      cb: (tx: unknown) => Promise<T>
    ): Promise<T> => {
      if (state.txOpen) throw new Error("nested tx not modelled");
      state.txOpen = true;
      state.trace.push("tx:begin");
      try {
        const result = await cb(buildDbHandle(true));
        state.txOpen = false;
        state.txOutcome = "committed";
        state.trace.push("tx:commit");
        return result;
      } catch (err) {
        state.txOpen = false;
        state.txOutcome = "rolled_back";
        state.trace.push("tx:rollback");
        throw err;
      }
    },
  };
  return handle;
}

function buildSelect(_cols: unknown, _isTx: boolean) {
  return {
    from: (table: { __tag?: string }) => ({
      where: (_clause: unknown) => ({
        limit: async (_n: number) => {
          if (table.__tag === "pvs_agent_enrollment_tokens") {
            return state.tokens.map((r) => ({ ...r }));
          }
          if (table.__tag === "pvs_link") {
            // The vendor-switch pre-check selects the current pvs_link's
            // vendor for the redeeming clinic.
            return state.existingLinks.map((l) => ({
              vendor: l.vendor,
            }));
          }
          return [];
        },
      }),
    }),
  };
}

function buildUpdate(table: { __tag?: string }, isTx: boolean) {
  return {
    set: (values: Record<string, unknown>) => ({
      where: (_clause: unknown) => ({
        returning: async (_proj: unknown) => {
          if (
            table.__tag === "pvs_agent_enrollment_tokens" &&
            !isTx
          ) {
            throw new Error(
              "token UPDATE must happen inside a transaction (P0-1)"
            );
          }
          if (table.__tag === "pvs_agent_enrollment_tokens") {
            state.trace.push("token:claim");
            if (state.raceClaimEmpty) {
              return [];
            }
            const tkn = state.tokens[0];
            if (!tkn) return [];
            // Race-safe equivalent: only "claim" if not yet consumed.
            if (tkn.consumedAt) return [];
            tkn.consumedAt = (values.consumedAt as Date) ?? new Date();
            return [{ id: tkn.id }];
          }
          return [];
        },
      }),
    }),
  };
}

function buildInsert(table: { __tag?: string }, isTx: boolean) {
  // Each step in the chain that could be the terminal `await` site must be
  // thenable. The real Drizzle builder is itself a thenable Promise-like at
  // every chain step; we emulate just enough of that for both shapes used in
  // the codebase: `…onConflictDoUpdate(spec)` (no `.returning()`) and
  // `…onConflictDoUpdate(spec).returning(proj)`.
  const fire = () => Promise.resolve(finishInsert(table, {}, isTx));
  return {
    values: (vals: Record<string, unknown>) => {
      const make = () => Promise.resolve(finishInsert(table, vals, isTx));
      const terminal = {
        returning: async (_proj: unknown) => make(),
        then: (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown
        ) => make().then(resolve, reject),
      };
      return {
        onConflictDoUpdate: (_spec: unknown) => terminal,
        onConflictDoNothing: (_spec?: unknown) => terminal,
        returning: terminal.returning,
        then: terminal.then,
      };
    },
  };
  // `fire` is unused in the current call shape; kept inert to flag if a
  // refactor introduces a `.insert(table)` directly-awaited form.
  void fire;
}

function finishInsert(
  table: { __tag?: string },
  vals: Record<string, unknown>,
  isTx: boolean
) {
  if (table.__tag === "platform_credentials") {
    if (!isTx) {
      throw new Error(
        "mint write must happen inside a transaction (P0-1)"
      );
    }
    state.trace.push("mint:credential");
    state.pvsCredentials.push({
      clinicId: vals.clinicId as string,
      platform: vals.platform as string,
      ciphertext: vals.accessTokenEnc as Buffer,
    });
    return [{ id: `cred-${state.pvsCredentials.length}` }];
  }
  if (table.__tag === "pvs_link") {
    if (!isTx) {
      throw new Error("link upsert must happen inside a transaction (P0-1)");
    }
    state.trace.push("link:upsert");
    if (state.failOnLinkUpsert) state.failOnLinkUpsert();
    state.pvsLinks.push({
      clinicId: vals.clinicId as string,
      vendor: vals.pvsVendor as string,
      status: vals.status as string,
    });
    return [];
  }
  if (table.__tag === "pvs_link_source") {
    if (!isTx) {
      throw new Error(
        "pvs_link_source seed must happen inside a transaction (Phase 7)"
      );
    }
    state.trace.push("link_source:seed");
    return [];
  }
  if (table.__tag === "pvs_link_audit") {
    if (!isTx) {
      throw new Error("audit write must happen inside a transaction (P1-3)");
    }
    state.trace.push(`audit:${vals.kind}`);
    state.auditRows.push({
      clinicId: vals.clinicId as string,
      kind: vals.kind as string,
      fromValue: (vals.fromValue as string | null) ?? null,
      toValue: (vals.toValue as string | null) ?? null,
      context: (vals.context as Record<string, unknown>) ?? {},
    });
    return [];
  }
  return [];
}

// Mock the schema. The real schema uses Drizzle pgTable objects; the
// module-under-test uses them only as opaque references inside the
// where/eq/insert/.update calls, so we replace them with tagged sentinels
// that buildDbHandle dispatches on.
vi.mock("@/db/client", () => {
  return {
    db: buildDbHandle(false),
    schema: {
      pvsAgentEnrollmentTokens: { __tag: "pvs_agent_enrollment_tokens" },
      pvsLink: {
        __tag: "pvs_link",
        // The vendor-switch pre-check selects this column; the mock select
        // only inspects the table tag, so the column sentinel is unused
        // beyond satisfying the call shape.
        pvsVendor: { __column: "pvs_vendor" },
        clinicId: { __column: "clinic_id" },
      },
      pvsLinkSource: {
        __tag: "pvs_link_source",
        clinicId: { __column: "clinic_id" },
        bridgeSource: { __column: "bridge_source" },
      },
      pvsLinkAudit: { __tag: "pvs_link_audit" },
      platformCredentials: { __tag: "platform_credentials" },
    },
  };
});

// `eq`, `and`, `isNull`, `gt` from drizzle-orm are used to build where
// clauses — we don't inspect them in the mock, so passthrough is fine.
// The real module is loaded; nothing to mock.

vi.mock("@/lib/crypto", async () => {
  // Real generateToken + sha256Hex would call node:crypto fine, but we
  // stub them deterministically to keep the test isolated.
  return {
    generateToken: (n: number) => "t".repeat(n),
    sha256Hex: (s: string) => `hash:${s}`,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
  };
});

vi.mock("@/server/clinic-signature", () => {
  return {
    invalidateSignatureSecretCache: (clinicId: string, platform: string) => {
      state.cacheInvalidations.push({ clinicId, platform });
    },
    mintAndStorePvsSecret: async (
      clinicId: string,
      _enc: (s: string) => Buffer,
      dbHandle: ReturnType<typeof buildDbHandle>
    ) => {
      // Use the (tx-bound) handle to write the credential, just like the
      // real function does. This is what proves the mint participates in
      // the transaction.
      await dbHandle.insert({ __tag: "platform_credentials" }).values({
        clinicId,
        platform: "pvs",
        accessTokenEnc: Buffer.from("test-secret-bytes"),
      }).onConflictDoUpdate({});
      return { secretHex: `mock-secret-for-${clinicId}`, rotated: true };
    },
  };
});

// Late import so the mocks resolve first.
let redeemAgentEnrollment: typeof import("./pvs-agent-enroll").redeemAgentEnrollment;

beforeEach(async () => {
  state = freshState();
  vi.resetModules();
  const mod = await import("./pvs-agent-enroll");
  redeemAgentEnrollment = mod.redeemAgentEnrollment;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- Tests -------------------------------------------------------------

describe("redeemAgentEnrollment — P0-1 atomicity contract", () => {
  const VALID_CLINIC = "11111111-2222-3333-4444-555555555555";
  const VALID_TOKEN = "t".repeat(32);
  const VALID_FINGERPRINT = "fp-abc";

  function seedToken(overrides: Partial<MockTokenRow> = {}): void {
    state.tokens.push({
      id: "tkn-1",
      clinicId: VALID_CLINIC,
      tokenHash: `hash:${VALID_TOKEN}`,
      expectedFingerprint: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      allowVendorSwitch: false,
      ...overrides,
    });
  }

  function seedExistingLink(vendor: string): void {
    state.existingLinks.push({
      clinicId: VALID_CLINIC,
      vendor,
      status: "connected",
    });
  }

  it("happy path: claims token → mints secret → upserts link → audits, in tx → invalidates cache after", async () => {
    seedToken();
    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: "1.2.3.4",
    });
    expect(result).toEqual({
      ok: true,
      pvsSecretHex: `mock-secret-for-${VALID_CLINIC}`,
      vendor: "gdt_agent",
    });
    // Tx committed exactly once.
    expect(state.txOutcome).toBe("committed");
    // Ordering: claim BEFORE mint BEFORE link BEFORE audit, all inside tx,
    // invalidation AFTER commit. No vendor_switch audit row because no
    // prior link existed.
    expect(state.trace).toEqual([
      "tx:begin",
      "token:claim",
      "mint:credential",
      "link:upsert",
      "link_source:seed",
      "audit:enrollment_redeemed",
      "tx:commit",
    ]);
    expect(state.cacheInvalidations).toEqual([
      { clinicId: VALID_CLINIC, platform: "pvs" },
    ]);
    // Writes landed.
    expect(state.pvsCredentials).toHaveLength(1);
    expect(state.pvsLinks).toHaveLength(1);
    expect(state.auditRows).toHaveLength(1);
    expect(state.auditRows[0]).toMatchObject({
      kind: "enrollment_redeemed",
      fromValue: null,
      toValue: "gdt_agent",
    });
  });

  it("rejects an invalid token without touching the DB", async () => {
    // No seedToken — pre-check finds nothing.
    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: "x".repeat(32),
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result).toEqual({ ok: false, reason: "token_invalid" });
    expect(state.txOutcome).toBeNull();
    expect(state.pvsCredentials).toHaveLength(0);
    expect(state.cacheInvalidations).toHaveLength(0);
  });

  it("rejects expired token without opening a tx", async () => {
    seedToken({ expiresAt: new Date(Date.now() - 60_000) });
    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result).toEqual({ ok: false, reason: "token_expired" });
    expect(state.txOutcome).toBeNull();
  });

  it("rejects already-consumed token (pre-check)", async () => {
    seedToken({ consumedAt: new Date(Date.now() - 1000) });
    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result).toEqual({ ok: false, reason: "token_consumed" });
    expect(state.txOutcome).toBeNull();
  });

  it("rejects fingerprint mismatch when token has expectedFingerprint", async () => {
    seedToken({ expectedFingerprint: "fp-different" });
    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result).toEqual({ ok: false, reason: "fingerprint_mismatch" });
    expect(state.txOutcome).toBeNull();
  });

  it("rejects clinic mismatch (caller's clinicId differs from token's)", async () => {
    seedToken({ clinicId: "99999999-2222-3333-4444-555555555555" });
    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result).toEqual({ ok: false, reason: "clinic_mismatch" });
    expect(state.txOutcome).toBeNull();
  });

  it("RACE: concurrent claim returns 0 rows → tx rolls back, no secret minted", async () => {
    // Pre-check sees an un-consumed token, but the conditional UPDATE
    // inside the tx returns 0 rows (another caller won the race).
    seedToken();
    state.raceClaimEmpty = true;

    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result).toEqual({ ok: false, reason: "token_consumed" });
    // Critically: tx ROLLED BACK, no credential was written, no cache invalidation
    // happened. This is the previously-broken case where a partial failure
    // could rotate a working secret out from under the legitimate agent.
    expect(state.txOutcome).toBe("rolled_back");
    expect(state.pvsCredentials).toHaveLength(0);
    expect(state.pvsLinks).toHaveLength(0);
    expect(state.cacheInvalidations).toHaveLength(0);
    expect(state.trace).toEqual([
      "tx:begin",
      "token:claim",
      "tx:rollback",
    ]);
  });

  it("ROLLBACK: a failure on pvs_link upsert rolls back the credential mint", async () => {
    seedToken();
    // Simulate a deadlock / transient failure on the pvs_link upsert,
    // AFTER the claim and mint have already executed inside the tx.
    state.failOnLinkUpsert = () => {
      throw new Error("simulated deadlock on pvs_link upsert");
    };

    await expect(
      redeemAgentEnrollment({
        clinicId: VALID_CLINIC,
        token: VALID_TOKEN,
        machineFingerprint: VALID_FINGERPRINT,
        remoteIp: null,
      })
    ).rejects.toThrow("simulated deadlock");

    // The real DB would roll back all three writes. Our mock can't
    // physically rewind pvsCredentials (the array push already happened),
    // but the test enforces the invariants the mock can prove:
    //   1) The tx CB threw (txOutcome=rolled_back).
    //   2) Cache invalidation did NOT run.
    //   3) Trace shows mint executed before the failed link upsert — i.e.
    //      everything ran inside the tx that the real DB would atomically
    //      undo. This is the exact race the P0-1 plan calls out.
    expect(state.txOutcome).toBe("rolled_back");
    expect(state.cacheInvalidations).toHaveLength(0);
    expect(state.trace).toEqual([
      "tx:begin",
      "token:claim",
      "mint:credential",
      "link:upsert",
      "tx:rollback",
    ]);
  });
});

describe("redeemAgentEnrollment — P1-3 vendor switch gate", () => {
  const VALID_CLINIC = "11111111-2222-3333-4444-555555555555";
  const VALID_TOKEN = "t".repeat(32);
  const VALID_FINGERPRINT = "fp-abc";

  function seedToken(overrides: Partial<MockTokenRow> = {}): void {
    state.tokens.push({
      id: "tkn-1",
      clinicId: VALID_CLINIC,
      tokenHash: `hash:${VALID_TOKEN}`,
      expectedFingerprint: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      allowVendorSwitch: false,
      ...overrides,
    });
  }
  function seedExistingLink(vendor: string): void {
    state.existingLinks.push({
      clinicId: VALID_CLINIC,
      vendor,
      status: "connected",
    });
  }

  it("refuses to switch from tomedo → gdt_agent when token has allowVendorSwitch=false", async () => {
    seedToken({ allowVendorSwitch: false });
    seedExistingLink("tomedo");

    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result).toEqual({
      ok: false,
      reason: "vendor_switch_requires_confirmation",
    });
    // No tx was opened — the gate ran outside the tx as a fast-fail.
    expect(state.txOutcome).toBeNull();
    expect(state.pvsCredentials).toHaveLength(0);
    expect(state.auditRows).toHaveLength(0);
  });

  it("allows switch from pabau → gdt_agent when token has allowVendorSwitch=true; audits BOTH events", async () => {
    seedToken({ allowVendorSwitch: true });
    seedExistingLink("pabau");

    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result.ok).toBe(true);
    expect(state.txOutcome).toBe("committed");
    // Both audit rows landed: the enrollment AND the vendor switch.
    expect(state.auditRows.map((r) => r.kind)).toEqual([
      "enrollment_redeemed",
      "vendor_switch",
    ]);
    expect(state.auditRows[1]).toMatchObject({
      kind: "vendor_switch",
      fromValue: "pabau",
      toValue: "gdt_agent",
    });
  });

  it("re-enrollment of an existing gdt_agent install (same vendor) does NOT trigger vendor_switch", async () => {
    // Reinstall scenario: clinic is already on gdt_agent, operator issues
    // a fresh enrollment token (e.g. for a workstation move). No switch
    // happens; we shouldn't require allow_vendor_switch=true.
    seedToken({ allowVendorSwitch: false });
    seedExistingLink("gdt_agent");

    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result.ok).toBe(true);
    expect(state.auditRows.map((r) => r.kind)).toEqual([
      "enrollment_redeemed",
    ]);
  });

  it("first-ever enrollment (no prior link) skips the switch gate entirely", async () => {
    seedToken({ allowVendorSwitch: false });
    // No seedExistingLink → no prior link at all.

    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result.ok).toBe(true);
    expect(state.auditRows).toHaveLength(1);
    expect(state.auditRows[0]?.kind).toBe("enrollment_redeemed");
  });

  it("prior vendor='none' is treated as 'no real vendor' and bypasses the gate", async () => {
    // The 'none' vendor is reserved for clinics that have a row but no
    // active adapter (legacy or admin-staged). Switching from 'none' to
    // 'gdt_agent' is fresh enrollment, not a switch.
    seedToken({ allowVendorSwitch: false });
    seedExistingLink("none");

    const result = await redeemAgentEnrollment({
      clinicId: VALID_CLINIC,
      token: VALID_TOKEN,
      machineFingerprint: VALID_FINGERPRINT,
      remoteIp: null,
    });
    expect(result.ok).toBe(true);
    expect(state.auditRows.map((r) => r.kind)).toEqual([
      "enrollment_redeemed",
    ]);
  });
});
