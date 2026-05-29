import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * confirmPvsLinkActive (P1-2) state-flip unit tests.
 *
 * Mocks the db layer to assert the transition contract: only pending →
 * connected is permitted, the audit row is atomic with the flip, and
 * concurrent confirmations are serialised by the conditional UPDATE.
 *
 * The replay loop is NOT exercised here — exercising it would require
 * mocking applyPvsEvent's entire downstream (linker, derive enqueue,
 * partition heal, ...). That's an integration-test concern and lives
 * behind a real ephemeral postgres in CI.
 */

interface MockLink {
  id: string;
  clinicId: string;
  status: string;
}

interface MockAuditRow {
  clinicId: string;
  kind: string;
  fromValue: string | null;
  toValue: string | null;
}

let state: {
  links: MockLink[];
  audits: MockAuditRow[];
  eventLog: Array<{
    id: string;
    clinicId: string;
    linkStatusAtIngest: string;
    appliedAt: Date | null;
    payload: unknown;
  }>;
  trace: string[];
  txOutcome: "committed" | "rolled_back" | null;
  // Force the conditional UPDATE to return 0 rows (race-lost simulation).
  forceUpdateZeroRows: boolean;
};

function freshState() {
  return {
    links: [] as MockLink[],
    audits: [] as MockAuditRow[],
    eventLog: [] as Array<{
      id: string;
      clinicId: string;
      linkStatusAtIngest: string;
      appliedAt: Date | null;
      payload: unknown;
    }>,
    trace: [] as string[],
    txOutcome: null as "committed" | "rolled_back" | null,
    forceUpdateZeroRows: false,
  };
}

// Track applyPvsEvent invocations from the replay loop without exercising
// its real body — the test only cares that the replayed rows were piped
// into it in occurred-at order. The arg type is `unknown` because
// applyPvsEvent's real signature is a discriminated union we don't want
// to drag into the test mock.
const applyPvsEventMock = vi.fn(
  async (_event: unknown): Promise<unknown> => ({
    ok: true as const,
    status: "deduped" as const,
  })
);

vi.mock("@/server/pvs-events", () => ({
  applyPvsEvent: applyPvsEventMock,
}));

vi.mock("@/db/client", () => {
  // Helper to build a thenable terminal — Drizzle builders are Promise-like
  // at every chain step, but in this mock we only handle the shapes that
  // pvs-link-state.ts actually uses.
  function mkSelect(tableTag: string) {
    return {
      from: () => ({
        where: () => ({
          limit: async () => {
            if (tableTag === "pvs_link") {
              return state.links.map((l) => ({
                id: l.id,
                status: l.status,
              }));
            }
            return [];
          },
          orderBy: () => ({
            limit: async () => {
              if (tableTag === "pvs_event_log") {
                return state.eventLog
                  .filter(
                    (r) =>
                      r.linkStatusAtIngest === "pending" &&
                      r.appliedAt === null
                  )
                  .map((r) => ({ id: r.id, payload: r.payload }));
              }
              return [];
            },
          }),
        }),
      }),
    };
  }

  function mkUpdate(tableTag: string, isTx: boolean) {
    return {
      set: (vals: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (tableTag === "pvs_link") {
              if (state.forceUpdateZeroRows) {
                state.trace.push("update:link:zero-rows");
                return [];
              }
              const link = state.links[0];
              if (!link || link.status !== "pending") {
                state.trace.push("update:link:nonpending-noop");
                return [];
              }
              link.status = vals.status as string;
              state.trace.push("update:link:flipped");
              return [{ id: link.id }];
            }
            return [];
          },
        }),
      }),
    };
  }

  function mkInsert(tableTag: string, isTx: boolean) {
    return {
      values: (vals: Record<string, unknown>) => {
        const terminal = {
          returning: async () => [],
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve().then(() => {
              if (tableTag === "pvs_link_audit") {
                if (!isTx) throw new Error("audit must be in tx");
                state.audits.push({
                  clinicId: vals.clinicId as string,
                  kind: vals.kind as string,
                  fromValue: (vals.fromValue as string | null) ?? null,
                  toValue: (vals.toValue as string | null) ?? null,
                });
                state.trace.push(`insert:audit:${vals.kind}`);
              }
              return resolve(undefined);
            }),
        };
        return terminal;
      },
    };
  }

  function mkDb(isTx: boolean) {
    return {
      select: () => ({
        from: (table: { __tag?: string }) => mkSelect(table.__tag ?? "").from(),
      }),
      update: (table: { __tag?: string }) => mkUpdate(table.__tag ?? "", isTx).set,
      insert: (table: { __tag?: string }) => mkInsert(table.__tag ?? "", isTx),
      transaction: async <T,>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
        state.trace.push("tx:begin");
        try {
          const result = await cb(mkDb(true));
          state.txOutcome = "committed";
          state.trace.push("tx:commit");
          return result;
        } catch (err) {
          state.txOutcome = "rolled_back";
          state.trace.push("tx:rollback");
          throw err;
        }
      },
    };
  }

  // Slightly different shape: select needs to support the long chain
  // (select().from().where().limit() and the eventLog variant with
  // orderBy().limit()). Re-emit mkSelect with the dispatch built in.
  const select = () => ({
    from: (table: { __tag?: string }) => mkSelect(table.__tag ?? "").from(),
  });
  // Also expose update().set() as a callable, since mkUpdate's `.set`
  // returns a function expecting `(vals)`. The Drizzle shape is
  // `db.update(table).set(vals).where(...).returning(...)`.
  const update = (table: { __tag?: string }) => ({
    set: (vals: Record<string, unknown>) =>
      mkUpdate(table.__tag ?? "", false).set(vals),
  });
  const update_tx = (table: { __tag?: string }) => ({
    set: (vals: Record<string, unknown>) =>
      mkUpdate(table.__tag ?? "", true).set(vals),
  });

  return {
    db: {
      select,
      update,
      insert: (table: { __tag?: string }) => mkInsert(table.__tag ?? "", false),
      transaction: async <T,>(cb: (tx: unknown) => Promise<T>) => {
        state.trace.push("tx:begin");
        try {
          const tx = {
            select,
            update: update_tx,
            insert: (table: { __tag?: string }) =>
              mkInsert(table.__tag ?? "", true),
          };
          const result = await cb(tx);
          state.txOutcome = "committed";
          state.trace.push("tx:commit");
          return result;
        } catch (err) {
          state.txOutcome = "rolled_back";
          state.trace.push("tx:rollback");
          throw err;
        }
      },
    },
    schema: {
      pvsLink: { __tag: "pvs_link" },
      pvsLinkAudit: { __tag: "pvs_link_audit" },
      pvsEventLog: { __tag: "pvs_event_log" },
    },
  };
});

let confirmPvsLinkActive: typeof import("./pvs-link-state").confirmPvsLinkActive;

beforeEach(async () => {
  state = freshState();
  applyPvsEventMock.mockClear();
  vi.resetModules();
  const mod = await import("./pvs-link-state");
  confirmPvsLinkActive = mod.confirmPvsLinkActive;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CLINIC = "11111111-2222-3333-4444-555555555555";
const ACTOR = "22222222-3333-4444-5555-666666666666";

function seedLink(status: string): void {
  state.links.push({ id: "link-1", clinicId: CLINIC, status });
}

function seedQuarantinedEvent(id: string, payload: object): void {
  state.eventLog.push({
    id,
    clinicId: CLINIC,
    linkStatusAtIngest: "pending",
    appliedAt: null,
    payload,
  });
}

describe("confirmPvsLinkActive — P1-2 state machine", () => {
  it("returns link_not_found when no pvs_link exists for the clinic", async () => {
    const result = await confirmPvsLinkActive({
      clinicId: CLINIC,
      actorUserId: ACTOR,
    });
    expect(result).toEqual({ ok: false, reason: "link_not_found" });
    expect(state.txOutcome).toBeNull();
  });

  it("returns alreadyActive when link is already connected (idempotent)", async () => {
    seedLink("connected");
    const result = await confirmPvsLinkActive({
      clinicId: CLINIC,
      actorUserId: ACTOR,
    });
    expect(result).toEqual({ ok: true, replayed: 0, alreadyActive: true });
    expect(state.txOutcome).toBeNull(); // no tx opened
    expect(state.audits).toHaveLength(0);
  });

  it("refuses non-pending, non-connected statuses", async () => {
    seedLink("error");
    const result = await confirmPvsLinkActive({
      clinicId: CLINIC,
      actorUserId: ACTOR,
    });
    expect(result).toEqual({ ok: false, reason: "wrong_status" });
  });

  it("pending → connected: flips status, writes audit, replays quarantined events", async () => {
    seedLink("pending");
    seedQuarantinedEvent("e-1", { kind: "PatientUpserted", x: 1 });
    seedQuarantinedEvent("e-2", { kind: "InvoicePaid", x: 2 });

    const result = await confirmPvsLinkActive({
      clinicId: CLINIC,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.alreadyActive).toBe(false);
    expect(result.replayed).toBe(2);

    expect(state.txOutcome).toBe("committed");
    expect(state.links[0]?.status).toBe("connected");
    expect(state.audits).toEqual([
      {
        clinicId: CLINIC,
        kind: "status_change",
        fromValue: "pending",
        toValue: "connected",
      },
    ]);
    // Replay invoked applyPvsEvent once per quarantined event, in order.
    expect(applyPvsEventMock).toHaveBeenCalledTimes(2);
    expect(applyPvsEventMock.mock.calls[0]?.[0]).toMatchObject({ x: 1 });
    expect(applyPvsEventMock.mock.calls[1]?.[0]).toMatchObject({ x: 2 });
  });

  it("race: concurrent confirmations only allow one to win (conditional UPDATE)", async () => {
    seedLink("pending");
    state.forceUpdateZeroRows = true; // simulate lost race

    const result = await confirmPvsLinkActive({
      clinicId: CLINIC,
      actorUserId: ACTOR,
    });
    // Lost-race is reported as alreadyActive — the OTHER caller did the
    // work; we never double-replay.
    expect(result).toEqual({ ok: true, replayed: 0, alreadyActive: true });
    expect(state.audits).toHaveLength(0);
    expect(applyPvsEventMock).not.toHaveBeenCalled();
  });

  it("partial replay: if applyPvsEvent throws, replayed count reflects only successes", async () => {
    seedLink("pending");
    seedQuarantinedEvent("e-1", { x: 1 });
    seedQuarantinedEvent("e-2", { x: 2 });
    seedQuarantinedEvent("e-3", { x: 3 });

    applyPvsEventMock.mockImplementationOnce(async () => ({
      ok: true,
      status: "deduped",
    }));
    applyPvsEventMock.mockImplementationOnce(async () => {
      throw new Error("simulated linker explosion");
    });
    applyPvsEventMock.mockImplementationOnce(async () => ({
      ok: true,
      status: "deduped",
    }));

    const result = await confirmPvsLinkActive({
      clinicId: CLINIC,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // e-1 ok, e-2 threw (not counted), e-3 ok → 2 replayed.
    expect(result.replayed).toBe(2);
  });
});
