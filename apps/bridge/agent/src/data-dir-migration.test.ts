import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listOtherUserLegacyDirs,
  migrateLegacyData,
  type MigrationOptions,
} from "./data-dir-migration.js";
import type { DpapiBackend } from "./secure-store.js";

let root: string;
let newDir: string;
let legacyDir: string;
let usersRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eins-mig-"));
  newDir = join(root, "ProgramData", "EINS-Agent");
  usersRoot = join(root, "Users");
  legacyDir = profileDir("Anna");
  mkdirSync(legacyDir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function profileDir(user: string): string {
  return join(usersRoot, user, "AppData", "Roaming", "EINS-Agent");
}

function plantLegacy(dir: string, extra: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ clinicId: "c1" }));
  writeFileSync(join(dir, "outbox.sqlite"), "outbox-bytes");
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(dir, name), body);
}

const fakeDpapi: DpapiBackend = {
  protect: async (plain) => `M:${plain}`,
  unprotect: async (blob) => blob.replace(/^U:/, ""),
};

function opts(over: Partial<MigrationOptions> = {}): MigrationOptions {
  return {
    newDir,
    legacyDir,
    isSystem: false,
    dpapi: fakeDpapi,
    platform: "win32",
    userName: "Anna",
    log: () => {},
    profilesRoot: usersRoot,
    isPidAlive: () => false,
    ...over,
  };
}

/** A lock file as an old, still running agent would have left it. */
function plantLiveLock(dir: string, name = "agent.lock"): void {
  writeFileSync(
    join(dir, name),
    JSON.stringify({ pid: 4242, startedAt: "2026-10-07T01:00:00.000Z", token: "old" })
  );
}

describe("migration: the happy path still works", () => {
  it("copies the data and commits config.json last", async () => {
    plantLegacy(legacyDir, { "secret.dpapi": "U:topsecret" });
    const r = await migrateLegacyData(opts());
    expect(r.status).toBe("migrated");
    expect(readFileSync(join(newDir, "secret.dpapi"), "utf8")).toBe("M:topsecret");
    expect(readFileSync(join(newDir, "outbox.sqlite"), "utf8")).toBe("outbox-bytes");
    expect(existsSync(join(newDir, "config.json"))).toBe(true);
  });
});

describe("migration refuses while the old agent may still run", () => {
  it("a live instance lock in the legacy dir blocks the migration and nothing is copied", async () => {
    plantLegacy(legacyDir);
    plantLiveLock(legacyDir);
    const r = await migrateLegacyData(opts({ isPidAlive: () => true }));
    expect(r.status).toBe("blocked");
    if (r.status !== "blocked") return;
    expect(r.message).toMatch(/4242/);
    expect(r.message).toMatch(/beenden/);
    expect(r.message).toMatch(/still running|is running/i);
    expect(existsSync(newDir)).toBe(false);
  });

  it("a live supervisor lock blocks as well", async () => {
    plantLegacy(legacyDir);
    plantLiveLock(legacyDir, "supervisor.lock");
    const r = await migrateLegacyData(opts({ isPidAlive: () => true }));
    expect(r.status).toBe("blocked");
  });

  it("a lock of a dead process is stale and does not block", async () => {
    plantLegacy(legacyDir);
    plantLiveLock(legacyDir);
    const r = await migrateLegacyData(opts({ isPidAlive: () => false }));
    expect(r.status).toBe("migrated");
  });

  it("a freshly written outbox WAL (a writer is active) blocks even without a lock file", async () => {
    plantLegacy(legacyDir, { "outbox.sqlite-wal": "wal" });
    const r = await migrateLegacyData(opts());
    expect(r.status).toBe("blocked");
  });

  it("an old WAL left by a crash does not block", async () => {
    plantLegacy(legacyDir, { "outbox.sqlite-wal": "wal" });
    const old = new Date(Date.now() - 3600_000);
    utimesSync(join(legacyDir, "outbox.sqlite-wal"), old, old);
    const r = await migrateLegacyData(opts());
    expect(r.status).toBe("migrated");
  });
});

describe("migration: legacy data under other user profiles", () => {
  it("lists every profile's legacy dir, skipping Public / Default, using an injectable root", async () => {
    plantLegacy(profileDir("Anna"));
    plantLegacy(profileDir("Bernd"));
    plantLegacy(profileDir("Public"));
    mkdirSync(profileDir("Clara"), { recursive: true }); // no config.json
    const found = await listOtherUserLegacyDirs({ SystemDrive: "C:" }, usersRoot);
    expect(found.sort()).toEqual([profileDir("Anna"), profileDir("Bernd")].sort());
  });

  it("as SYSTEM with data in one profile: unreachable, names the path", async () => {
    rmSync(legacyDir, { recursive: true, force: true });
    plantLegacy(profileDir("Bernd"));
    const r = await migrateLegacyData(
      opts({ legacyDir: join(root, "systemprofile", "EINS-Agent"), isSystem: true })
    );
    expect(r.status).toBe("unreachable");
    if (r.status !== "unreachable") return;
    expect(r.legacyDirs).toEqual([profileDir("Bernd")]);
    expect(r.message).toContain(profileDir("Bernd"));
  });

  it("more than one candidate: picks none, copies nothing, lists all paths", async () => {
    plantLegacy(profileDir("Anna"));
    plantLegacy(profileDir("Bernd"));
    const r = await migrateLegacyData(opts({ scanAllProfiles: true }));
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.legacyDirs.sort()).toEqual([profileDir("Anna"), profileDir("Bernd")].sort());
    expect(r.message).toContain(profileDir("Anna"));
    expect(r.message).toContain(profileDir("Bernd"));
    expect(existsSync(newDir)).toBe(false);
  });

  it("an elevated admin who is not the setup user is told where the data is (no silent no-op)", async () => {
    rmSync(legacyDir, { recursive: true, force: true });
    plantLegacy(profileDir("Bernd"));
    const r = await migrateLegacyData(opts({ scanAllProfiles: true }));
    expect(r.status).toBe("unreachable");
  });

  it("exactly one candidate that is the current user's: migrates", async () => {
    plantLegacy(profileDir("Anna"));
    const r = await migrateLegacyData(opts({ scanAllProfiles: true }));
    expect(r.status).toBe("migrated");
  });
});

describe("migration: stale .migrating-<pid> temp copies", () => {
  const tmpName = (n: string, pid: number): string => join(newDir, `${n}.migrating-${pid}`);

  it("removes temp files of dead processes and files older than 1 h at the start; keeps a fresh one of a live pid", async () => {
    plantLegacy(legacyDir);
    mkdirSync(newDir, { recursive: true });
    writeFileSync(tmpName("outbox.sqlite", 111), "x"); // pid dead
    writeFileSync(tmpName("old.bin", 333), "x"); // pid alive but old
    const old = new Date(Date.now() - 2 * 3600_000);
    utimesSync(tmpName("old.bin", 333), old, old);
    writeFileSync(tmpName("busy.bin", 444), "x"); // pid alive, fresh
    const r = await migrateLegacyData(
      opts({ isPidAlive: (pid) => pid === 333 || pid === 444 })
    );
    expect(r.status).toBe("migrated");
    const left = readdirSync(newDir).filter((n) => /\.migrating-\d+$/.test(n));
    expect(left).toEqual(["busy.bin.migrating-444"]);
  });

  it("after a FAILED migration its own temp files are gone", async () => {
    plantLegacy(legacyDir, { "bad.dpapi": "U:x" });
    const failing: DpapiBackend = {
      protect: fakeDpapi.protect,
      unprotect: async () => {
        throw new Error("cannot decrypt");
      },
    };
    // A leftover from this very process (as a half-finished copy would be).
    mkdirSync(newDir, { recursive: true });
    writeFileSync(tmpName("outbox.sqlite", process.pid), "partial");
    const r = await migrateLegacyData(opts({ dpapi: failing, isPidAlive: () => true }));
    expect(r.status).toBe("failed");
    expect(readdirSync(newDir).filter((n) => /\.migrating-/.test(n))).toEqual([]);
    expect(existsSync(join(newDir, "config.json"))).toBe(false);
  });
});
