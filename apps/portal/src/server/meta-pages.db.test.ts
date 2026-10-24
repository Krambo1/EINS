/**
 * E6 binding store against a REAL local Postgres (unique index of 0088,
 * clinic-scoped WHERE clauses, last_sync_error CASE), everything inside one
 * transaction that is rolled back at the end (no rows stay). Opt-in and
 * local only:
 *   META_PAGES_DB_TEST=1 DATABASE_URL=<local url> npx vitest run src/server/meta-pages.db.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

afterEach(() => {
  vi.unstubAllGlobals();
});

const enabled = process.env.META_PAGES_DB_TEST === "1";

class Rollback extends Error {}

describe.skipIf(!enabled)("E6 Meta page binding (local DB, rolled back)", () => {
  it("binds, refuses pages of other Praxen (pre-check and unique index), re-binds, clears only page hints", async () => {
    const host = new URL(process.env.DATABASE_URL ?? "postgres://invalid").hostname;
    expect(["localhost", "127.0.0.1", "::1", "[::1]"], "local DB only").toContain(host);

    // E6b: bindMetaPage subscribes the page; Graph is mocked, never called.
    const graph = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", graph);

    const { db, schema } = await import("@/db/client");
    const { and, eq, inArray } = await import("drizzle-orm");
    const { encryptString, decryptString } = await import("@/lib/crypto");
    const m = await import("./meta-pages");
    const pc = schema.platformCredentials;

    const clinics = await db.select({ id: schema.clinics.id }).from(schema.clinics).limit(2);
    expect(clinics.length, "local DB needs two clinics").toBe(2);
    const [A, B] = clinics.map((c) => c.id) as [string, string];
    const [P1, P2, P3, P4] = ["0000000000000001", "0000000000000002", "0000000000000003", "0000000000000004"];
    const page = (id: string, token: string) => ({ id, name: `Seite ${id}`, access_token: token });
    const SYNC_ERROR = "Abgleich fehlgeschlagen: Werbekonto gesperrt";

    await expect(
      db.transaction(async (tx) => {
        const h = tx as unknown as typeof db;
        await h.delete(pc).where(and(inArray(pc.clinicId, [A, B]), eq(pc.platform, "meta")));
        await h.update(pc).set({ metaPageId: null }).where(inArray(pc.metaPageId, [P1, P2, P3, P4]));
        await h.insert(pc).values([
          {
            clinicId: A,
            platform: "meta",
            accessTokenEnc: encryptString("user-A"),
            lastSyncError: m.metaPageErrorText(new Error(m.META_PAGE_ERRORS.multiplePages)),
          },
          {
            clinicId: B,
            platform: "meta",
            accessTokenEnc: encryptString("user-B"),
            metaPageId: P2,
            metaPageAccessTokenEnc: encryptString("old-2"),
            lastSyncError: SYNC_ERROR,
          },
        ]);
        const store = m.makeDbMetaBindingStore(h);
        const read = async (clinicId: string) =>
          (
            await h
              .select({ pageId: pc.metaPageId, tok: pc.metaPageAccessTokenEnc, err: pc.lastSyncError })
              .from(pc)
              .where(and(eq(pc.clinicId, clinicId), eq(pc.platform, "meta")))
          )[0]!;

        // connection(): this Praxis's row only (B's page token for E6b).
        const conn = await store.connection(A);
        expect(conn?.pageId).toBeNull();
        expect(conn?.pageTokenEnc).toBeNull();
        expect(decryptString(conn!.accessTokenEnc)).toBe("user-A");
        expect(decryptString((await store.connection(B))!.pageTokenEnc!)).toBe("old-2");

        // setSyncError(): this Praxis only; the next binding clears the leadgen hint.
        const leadgenHint = m.metaPageErrorText(new Error(m.META_PAGE_ERRORS.leadgenSubscribeFailed));
        await store.setSyncError(A, leadgenHint);
        expect((await read(A)).err).toBe(leadgenHint);
        expect((await read(B)).err).toBe(SYNC_ERROR);

        // boundToOtherClinic(): only other Praxen count.
        expect([...(await store.boundToOtherClinic(A, [P1, P2]))]).toEqual([P2]);
        expect((await store.boundToOtherClinic(B, [P2])).size).toBe(0);

        // Bind P1 for A: page token encrypted, the page hint is cleared.
        await m.bindMetaPage(store, A, page(P1, "fresh-1"));
        const a1 = await read(A);
        expect(a1.pageId).toBe(P1);
        expect(decryptString(a1.tok!)).toBe("fresh-1");
        expect(a1.err).toBeNull();

        // Re-binding keeps a real sync error visible.
        await m.bindMetaPage(store, B, page(P2, "fresh-2"));
        const b1 = await read(B);
        expect(b1.err).toBe(SYNC_ERROR);
        expect(decryptString(b1.tok!)).toBe("fresh-2");

        // Pre-check refuses a page of another Praxis.
        await expect(m.bindMetaPage(store, A, page(P2, "steal"))).rejects.toThrow(
          m.META_PAGE_ERRORS.boundElsewhere
        );
        // Stale pre-check: the unique index refuses (savepoint keeps tx usable).
        await expect(
          tx.transaction(async (sp) => {
            const spStore = m.makeDbMetaBindingStore(sp as unknown as typeof db);
            await m.bindMetaPage(
              { ...spStore, boundToOtherClinic: async () => new Set<string>() },
              A,
              page(P2, "steal")
            );
          })
        ).rejects.toThrow(m.META_PAGE_ERRORS.boundElsewhere);
        expect((await read(B)).pageId).toBe(P2);
        expect(decryptString((await read(B)).tok!)).toBe("fresh-2");
        expect((await read(A)).pageId).toBe(P1);

        // Re-bind A to P3 releases P1; B may then take P1; P3 stays with A.
        await m.bindMetaPage(store, A, page(P3, "fresh-3"));
        await expect(m.bindMetaPage(store, B, page(P3, "steal"))).rejects.toThrow(
          m.META_PAGE_ERRORS.boundElsewhere
        );
        await m.bindMetaPage(store, B, page(P1, "fresh-1b"));
        expect((await read(A)).pageId).toBe(P3);
        expect((await read(B)).pageId).toBe(P1);

        // E6b: each of the 4 successful bindings subscribed its page; the
        // switch A: P1 -> P3 found P1 unbound and unsubscribed it, the switch
        // B: P2 -> P1 found P2 unbound too. Refused bindings call nothing.
        for (const [u] of graph.mock.calls) {
          expect(String(u)).toMatch(/^https:\/\/graph\.facebook\.com\/[^/]+\/\d+\/subscribed_apps$/);
        }
        const calls = graph.mock.calls.map(([u, init]) => [
          init?.method,
          String(u).split("/").at(-2),
        ]);
        expect(calls).toEqual([
          ["POST", P1],
          ["POST", P2],
          ["POST", P3],
          ["DELETE", P1],
          ["POST", P1],
          ["DELETE", P2],
        ]);

        // A Praxis without a Meta row binds nothing.
        await expect(m.bindMetaPage(store, randomUUID(), page(P4, "x"))).rejects.toThrow(
          m.META_PAGE_ERRORS.notConnected
        );
        const p4 = await h.select({ id: pc.id }).from(pc).where(eq(pc.metaPageId, P4));
        expect(p4).toHaveLength(0);

        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);

    // Nothing stayed.
    const left = await db
      .select({ id: pc.id })
      .from(pc)
      .where(inArray(pc.metaPageId, [P1, P2, P3, P4]));
    expect(left).toHaveLength(0);
  });
});
