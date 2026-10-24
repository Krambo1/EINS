import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PUBLIC_KEY, FIXTURE_SIGNED_BUNDLE } from "./__fixtures__/pvs-signed-config";

vi.mock("server-only", () => ({}));

/** Highest existing version for the vendor publishBundle is asked about. */
let topVersion: number | null = null;
/** Rows the next db.execute() call should return, in call order. */
let executeQueue: unknown[][] = [];
const inserted: Array<Record<string, unknown>> = [];

vi.mock("@/db/client", () => ({
  db: {
    select: (_proj: unknown) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => ({
          orderBy: (_o: unknown) => ({
            limit: (_n: number) =>
              Promise.resolve(
                topVersion === null ? [] : [{ version: topVersion }]
              ),
          }),
        }),
      }),
    }),
    insert: (_t: unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: (_p: unknown) => {
          inserted.push(vals);
          return Promise.resolve([{ id: "cfg-1" }]);
        },
      }),
    }),
    execute: (_q: unknown) => Promise.resolve(executeQueue.shift() ?? []),
  },
  schema: {
    pvsVendorConfig: {
      vendor: "vendor",
      version: "version",
      id: "id",
    },
    pvsVendorConfigTarget: {},
  },
}));

let publicKeys: string | undefined = JSON.stringify([FIXTURE_PUBLIC_KEY]);
vi.mock("@/lib/env", () => ({
  env: {
    get PVS_CONFIG_PUBLIC_KEYS() {
      return publicKeys;
    },
  },
}));

const {
  configSigningConfigured,
  publishBundle,
  resolveBundles,
  resolveManifest,
} = await import("./pvs-vendor-config");

beforeEach(() => {
  topVersion = null;
  executeQueue = [];
  inserted.length = 0;
  publicKeys = JSON.stringify([FIXTURE_PUBLIC_KEY]);
});

describe("publishBundle", () => {
  it("stores a verified bundle with the rollout switched off", async () => {
    const res = await publishBundle(FIXTURE_SIGNED_BUNDLE, "karam@eins.ag");

    expect(res).toMatchObject({ ok: true, vendor: "fixture-db", version: 7 });
    expect(inserted).toHaveLength(1);
    // Publishing must never be the same action as deploying.
    expect(inserted[0]!.rolloutMode).toBe("off");
    expect(inserted[0]!.uploadedByEmail).toBe("karam@eins.ag");
  });

  it("keeps the uploaded bundle byte-identical so the signature stays valid", async () => {
    await publishBundle(FIXTURE_SIGNED_BUNDLE, null);
    expect(inserted[0]!.bundle).toEqual(FIXTURE_SIGNED_BUNDLE);
  });

  it("accepts the bundle as pasted JSON text", async () => {
    const res = await publishBundle(
      JSON.stringify(FIXTURE_SIGNED_BUNDLE),
      null
    );
    expect(res.ok).toBe(true);
  });

  it("rejects text that is not JSON", async () => {
    const res = await publishBundle("{nope", null);
    expect(res).toMatchObject({ ok: false });
    expect(inserted).toHaveLength(0);
  });

  it("rejects a tampered bundle before it reaches the table", async () => {
    const res = await publishBundle(
      { ...FIXTURE_SIGNED_BUNDLE, yaml: "vendor: fixture-db\n" },
      null
    );
    expect(res).toMatchObject({ ok: false });
    expect(inserted).toHaveLength(0);
  });

  it("refuses everything when no public key is configured", async () => {
    publicKeys = undefined;
    expect(configSigningConfigured()).toBe(false);
    const res = await publishBundle(FIXTURE_SIGNED_BUNDLE, null);
    expect(res).toMatchObject({ ok: false });
    expect(inserted).toHaveLength(0);
  });

  it("refuses a version that is not above the highest existing one", async () => {
    // Agents refuse anything at or below the version they run, so a reused
    // number would publish cleanly here and be silently ignored everywhere.
    topVersion = 7;
    const res = await publishBundle(FIXTURE_SIGNED_BUNDLE, null);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) {
      expect(res.reason).toMatch(/Version 7/);
      // The message has to say which number to use next, or the operator has
      // to go and look it up before they can re-sign.
      expect(res.reason).toMatch(/Version 8/);
    }
    expect(inserted).toHaveLength(0);
  });

  it("refuses a version below the highest existing one", async () => {
    topVersion = 9;
    const res = await publishBundle(FIXTURE_SIGNED_BUNDLE, null);
    expect(res).toMatchObject({ ok: false });
    expect(inserted).toHaveLength(0);
  });

  it("accepts the next version up", async () => {
    topVersion = 6;
    const res = await publishBundle(FIXTURE_SIGNED_BUNDLE, null);
    expect(res).toMatchObject({ ok: true, version: 7 });
  });
});

describe("resolveManifest", () => {
  it("returns one entry per vendor with numeric versions", async () => {
    executeQueue = [
      [{ vendor: "tomedo-db", version: "4", sha256: "a".repeat(64) }],
    ];
    await expect(resolveManifest("clinic-1")).resolves.toEqual([
      { vendor: "tomedo-db", version: 4, sha256: "a".repeat(64) },
    ]);
  });
});

describe("resolveBundles", () => {
  it("only serves a vendor the clinic is actually targeted with", async () => {
    // Manifest resolution says this clinic gets tomedo-db v4 and nothing else.
    executeQueue = [
      [{ vendor: "tomedo-db", version: 4, sha256: "a".repeat(64) }],
    ];
    const out = await resolveBundles("clinic-1", ["medatixx-db"]);
    expect(out).toEqual([]);
    // The second query never ran: nothing was eligible.
    expect(executeQueue).toHaveLength(0);
  });

  it("serves the stored bundle verbatim for an eligible vendor", async () => {
    executeQueue = [
      [{ vendor: "fixture-db", version: 7, sha256: FIXTURE_SIGNED_BUNDLE.sha256 }],
      [{ vendor: "fixture-db", version: 7, bundle: FIXTURE_SIGNED_BUNDLE }],
    ];
    const out = await resolveBundles("clinic-1", ["fixture-db"]);
    expect(out).toEqual([FIXTURE_SIGNED_BUNDLE]);
  });

  it("ignores vendor ids that could escape a path on the agent side", async () => {
    const out = await resolveBundles("clinic-1", ["../../etc/passwd"]);
    expect(out).toEqual([]);
  });

  it("does nothing for an empty request", async () => {
    await expect(resolveBundles("clinic-1", [])).resolves.toEqual([]);
  });
});
