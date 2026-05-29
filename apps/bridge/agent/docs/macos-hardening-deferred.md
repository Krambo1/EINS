# macOS hardening: deferred, needs a Mac

Two PVS-bridge review items can only be finished and verified on a real Mac.
This runbook is implementation-ready so a future session (or Karam, on a Mac)
can close them turnkey. Neither was shipped blind from Windows.

- **#11**: the macOS Keychain writer leaks the plaintext secret on the
  process command line.
- **#2**: the macOS agent bundle + `.dmg` packaging / notarization is unbuilt
  and unverified.

Both matter because **Tomedo, a priority PVS, runs on macOS** (Zollsoft
read-only Postgres; see the Tomedo onboarding doc).

---

## #11: Keychain secret leaks on the command line

### The bug

`storeMacOsKeychain()` in [`src/secure-store.ts`](../src/secure-store.ts)
stores every secret with:

```
security add-generic-password -s EINS-Agent -a <account> -w <secret>
```

`-w <secret>` puts the **plaintext secret as an argv element**. On macOS a
process's arguments are readable by any other process of the same user
(`ps -ww -ax -o args`, and the kernel's `KERN_PROCARGS2`). So during every
store / rotation, the secret is world-readable-to-same-user for the lifetime
of the `security` child.

This is the exact analogue of the Windows DPAPI leak already fixed (that path
now feeds the payload via **stdin** behind `-EncodedCommand <fixed-stub>`; see
`psDpapi` / `DPAPI_STUB` in the same file).

`storeMacOsKeychain` is the single funnel for **all three** macOS secrets, so
one fix covers them all:

| Caller | Account | Secret kind |
|---|---|---|
| `storeSecret` | `pvs-hmac-secret` | 64-char hex PVS HMAC secret |
| `storeOutboxMasterKey` | `outbox-master-key` | 64-char hex SQLCipher master key |
| `storeDbCredential(id)` | `db-cred:<id>` | **arbitrary** DB password |

The **load** path is NOT affected: `find-generic-password ... -w` uses `-w` in
its *display* sense (print the password to **stdout**), so the secret travels
on the captured pipe, never on argv. Only the **store** path leaks.

### The fix (recommended)

Route the secret-bearing `add` through `security -i` (interactive batch mode),
which **reads its commands from stdin**, so the command (and the secret in it)
never lands in argv. Only `security -i` shows up in `ps`.

Because the interactive reader tokenizes each line shell-style, an arbitrary DB
password could break the parse or inject arguments. Neutralize that by storing
the **base64** of the value (base64's alphabet `A-Za-z0-9+/=` contains no
whitespace, quote, backslash, or newline, and never starts with `-`). A small
version prefix lets the loader tell new (base64) values from any legacy raw one.

```ts
const KEYCHAIN_VALUE_PREFIX = "b64:"; // marks base64-encoded values

async function storeMacOsKeychain(secret: string, account: string): Promise<void> {
  // Encode first so the value is tokenizer-safe inside `security -i`.
  const encoded = KEYCHAIN_VALUE_PREFIX + Buffer.from(secret, "utf8").toString("base64");
  // -U updates the item if it already exists (rotation), else adds it, so we
  // no longer need a separate delete-then-add. SERVICE and `account` are
  // controlled tokens ([A-Za-z0-9_:-]), safe to interpolate; the SECRET is the
  // only untrusted part and it is base64 above.
  const command = `add-generic-password -U -s ${SERVICE} -a ${account} -w ${encoded}\n`;
  const { code, stderr } = await spawnFeedStdin("security", ["-i"], command);
  if (code !== 0) {
    throw new Error(`security -i add-generic-password failed (${code}): ${stderr.trim()}`);
  }
  // VERIFY-ON-MAC #3 (see below): if `security -i` always exits 0, replace the
  // code check with a read-back: loadMacOsKeychain(account) must equal `secret`.
}

async function loadMacOsKeychain(account: string): Promise<string | null> {
  try {
    const out = await spawn1("security", [
      "find-generic-password", "-s", SERVICE, "-a", account, "-w",
    ]);
    const raw = out.trim();
    if (!raw) return null;
    if (raw.startsWith(KEYCHAIN_VALUE_PREFIX)) {
      return Buffer.from(raw.slice(KEYCHAIN_VALUE_PREFIX.length), "base64").toString("utf8");
    }
    return raw; // legacy raw value written before this fix
  } catch {
    return null;
  }
}

// New helper: spawn a command, write `input` to stdin, resolve stdout/stderr/code.
function spawnFeedStdin(
  cmd: string,
  args: string[],
  input: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    if (!child.stdin) return reject(new Error(`${cmd} stdin unavailable`));
    child.stdin.write(input);
    child.stdin.end();
  });
}
```

### What IS verifiable on Windows (do this, gate the regression)

The existing P0-3 test (`src/secure-store.test.ts`) mocks `node:child_process`
and asserts argv hygiene cross-platform by forcing `process.platform`. Add a
darwin block the same way: it runs in CI on any OS and locks the leak shut:

```ts
describe("secure-store · macOS Keychain argv hygiene (#11)", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  it("storeSecret: secret is NOT in argv; it rides stdin to `security -i`", async () => {
    const SECRET = "deadbeef".repeat(8);
    await storeSecret(SECRET);
    const { command, args, stdinChunks } = spawnCalls.at(-1)!;
    expect(command).toBe("security");
    expect(args).toEqual(["-i"]);
    for (const a of args) expect(a).not.toContain(SECRET);
    const stdin = Buffer.concat(stdinChunks).toString("utf8");
    expect(stdin).toMatch(/^add-generic-password -U /);
    expect(stdin).not.toContain(SECRET);              // raw secret never on the line
    const b64 = stdin.split(" -w ")[1]!.trim().replace(/^b64:/, "");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(SECRET); // round-trips
  });

  it("storeDbCredential: a nasty password with spaces/quotes stays base64", async () => {
    const PW = `it's "weird"; rm -rf /`;
    await storeDbCredential("tomedo-default", PW);
    const { args, stdinChunks } = spawnCalls.at(-1)!;
    for (const a of args) expect(a).not.toContain(PW);
    const stdin = Buffer.concat(stdinChunks).toString("utf8");
    expect(stdin).not.toContain(PW);
    expect(stdin).not.toMatch(/['"]/); // no raw quotes leaked into the command line
  });
});
```

> The existing mock pushes a `protect`/`unprotect` stdout; the darwin add path
> only checks the exit code, so the mock's `close(0)` already satisfies it.

### What needs a real Mac (MUST verify before shipping)

The argv-hygiene test proves the secret is off the command line. It does NOT
prove the new invocation actually works against the real `security` binary. A
wrong assumption here would brick macOS enrollment, worse than the leak, so
do not ship to a Praxis until these three are confirmed on a Mac:

1. **`security -i` reads a piped (non-tty) stdin and runs the subcommand.**
   Expected yes (interactive/batch mode is built for scripted input), but
   verify under a headless `spawn` (no pty), which is how the agent runs.
2. **`-w <value>` inline in interactive mode consumes the value (does not
   prompt).** Expected yes; verify it neither prompts nor hangs.
3. **Exit-code propagation.** Does `security -i` exit non-zero when the
   subcommand fails, or always exit 0 (REPL semantics)? If it always exits 0,
   switch the error check to a **read-back**: after the store, call
   `loadMacOsKeychain(account)` and assert it equals the secret.

### Mac round-trip test (copy-paste)

```bash
set -euo pipefail
SVC=EINS-Agent-TEST
acct=rt-$$

store() { printf 'add-generic-password -U -s %s -a %s -w b64:%s\n' "$SVC" "$acct" \
  "$(printf %s "$1" | base64)" | security -i; }
load()  { security find-generic-password -s "$SVC" -a "$acct" -w | sed 's/^b64://' | base64 -d; }

# 1) hex secret round-trip
HEX=$(printf 'deadbeef%.0s' {1..8}); store "$HEX"; [ "$(load)" = "$HEX" ] && echo "hex OK"
# 2) nasty DB password round-trip
PW='it'\''s "weird"; rm -rf /'; store "$PW"; [ "$(load)" = "$PW" ] && echo "nasty OK"
# 3) argv leak check: while a store runs, `ps` must NOT show the secret
( store "$HEX" & sleep 0.05; ps -ww -ax -o args | grep -F "$HEX" && echo "LEAK!" || echo "no leak"; wait )
# cleanup
security delete-generic-password -s "$SVC" -a "$acct" >/dev/null 2>&1 || true
```

Then the **real agent round-trip**: enroll an agent on the Mac, confirm the PVS
HMAC secret + outbox master key are stored and that a subsequent boot loads them
(events sign + the encrypted outbox opens). Re-run after a rotation.

### Fallback if `security -i` is unreliable headlessly

There is no `-w @file` flag, so a temp file does not help directly. The robust
fallback is a Keychain write via the Security framework (`SecItemAdd`): either
a tiny signed/notarized helper binary, or the `@napi-rs/keyring` N-API module.
Both add a native dependency to the bundle, so they intersect with #2 below
(ABI / signing). Prefer the `security -i` fix if the three checks pass.

---

## #2: macOS agent bundle + `.dmg` (build, verify, notarize)

The Windows path of this exact smoke test already passes. Reproduce it on macOS,
then package.

### ABI invariant (read first)

From [`scripts/bundle.mjs`](../scripts/bundle.mjs): build the bundle under the
**same Node major you ship**.
- `better-sqlite3-multiple-ciphers` is a V8-ABI (NAN) addon; its prebuilt binary
  is Node-major-specific (`node-v137` = Node 24, `node-v127` = Node 22,
  `node-v115` = Node 20). A binding built under the wrong major dies at startup
  with "Could not locate the bindings file".
- `oracledb` is N-API, keyed by platform+arch only; ABI-stable across majors.

Dev Node here is **24.15.0**. If shipping Node 24, build the bundle under Node 24
on the Mac. `bundle.mjs` asserts the SQLCipher `.node` is present and aborts the
build otherwise, so a non-bootable bundle cannot ship silently.

### Build

```bash
pnpm --filter eins-agent build:bundle
```

Runs `tsc` + `copy-assets.mjs` + `bundle.mjs`: compiles `dist/`, materializes a
flat real-file production `node_modules` via `npm install --omit=dev` (fetches
the SQLCipher prebuild for darwin-<arch> + this Node major, **needs network**),
fail-louds if the binding is missing, and prunes foreign-platform `oracledb`
binaries (keeps `darwin-<arch>.node`).

### Isolated smoke test (mirror the verified Windows run)

Run from a copy **outside the repo** so module resolution cannot leak onto the
monorepo `node_modules`:

```bash
SMOKE="$HOME/eins-agent-smoke"
rm -rf "$SMOKE"; cp -R apps/bridge/agent/bundle "$SMOKE"

CFG="$HOME/Library/Application Support/EINS-Agent"
mkdir -p "$CFG"
cat > "$CFG/config.json" <<JSON
{ "clinicId": "00000000-0000-0000-0000-000000000000",
  "portalBaseUrl": "http://localhost:9",
  "watchFolder": "$HOME/eins-agent-smoke-watch",
  "machineFingerprint": "smoke-test" }
JSON
mkdir -p "$HOME/eins-agent-smoke-watch"

node "$SMOKE/dist/index.js" --allow-insecure-dev &  PID=$!
sleep 4; kill "$PID" 2>/dev/null || true
```

Confirm ALL of:
- logs `[agent] starting`.
- `"$CFG/outbox.sqlite"` exists and its header is **NOT** `SQLite format 3`
  (i.e. SQLCipher-encrypted): `head -c 16 "$CFG/outbox.sqlite" | xxd` must NOT
  read `SQLite format 3\0`.
- the outbox **master key** is stored (Keychain `outbox-master-key`). NOTE: this
  exercises `storeMacOsKeychain`, so run this **after** the #11 fix or expect the
  master key to flash on argv during this boot.
- the run does **not** hit the legacy-plaintext migration branch (no
  "legacy plaintext outbox" log line). That branch was the first-boot brick the
  Windows smoke test caught; macOS must be clean too.

### Package + notarize (owner-side, needs Apple signing certs)

1. Wrap `bundle/` (drop a pinned `node`/`node` runtime next to `dist/` for a
   self-contained install; the launchers prefer a co-located `node`).
2. `codesign --options runtime --timestamp` every nested binary **including the
   `.node` addons** (Developer ID Application cert), then the app/pkg.
3. Build the `.dmg`, then notarize:
   `xcrun notarytool submit EINS-Agent.dmg --apple-id ... --team-id ... --wait`
4. `xcrun stapler staple EINS-Agent.dmg` and verify with `spctl -a -vvv`.

Hardened runtime is required for notarization; unsigned `.node` files are the
usual notarization rejection: sign them explicitly.

---

## Sequencing

Fix **#11 first**, then run **#2**: the #2 smoke test stores the outbox master
key through the same `storeMacOsKeychain` path, so doing #11 first means the
smoke test does not itself leak the master key on argv.
