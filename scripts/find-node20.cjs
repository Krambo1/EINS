/**
 * Shared Node 20 finder for dev wrappers (apps/portal, apps/bridge).
 *
 * Vercel runs Node 20. Newer Node (22+) ships an undici with tighter
 * headers timeouts that makes Next's dev "forward action response" fetch
 * spam UND_ERR_HEADERS_TIMEOUT. Even where that specific symptom doesn't
 * apply (e.g. the bridge has no Next), we still pin to Node 20 in dev so
 * local behaviour matches production.
 *
 * `pinNode20IntoEnv(childEnv)` mutates and returns childEnv with the
 * Node 20 binary's directory prepended to PATH. If Node 20 isn't found
 * on disk, it prints a single WARN line and leaves PATH untouched.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function verifyNode20(binary) {
  try {
    const out = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
    return out.startsWith("v20.") ? binary : null;
  } catch {
    return null;
  }
}

function findNode20() {
  const currentMajor = Number(process.versions.node.split(".")[0]);
  if (currentMajor === 20) return process.execPath;

  const exe = process.platform === "win32" ? "node.exe" : "node";
  const candidates = [];
  const home = process.env.USERPROFILE || process.env.HOME;

  // scoop (Windows) — what Karam has installed
  if (home) {
    candidates.push(path.join(home, "scoop", "apps", "nodejs20", "current", exe));
    candidates.push(path.join(home, "scoop", "apps", "nodejs", "current", exe));
  }

  // nvm-windows
  const nvmHome = process.env.NVM_HOME;
  if (nvmHome) {
    try {
      for (const d of fs.readdirSync(nvmHome)) {
        if (d.startsWith("v20.")) candidates.push(path.join(nvmHome, d, exe));
      }
    } catch {}
  }

  // nvm (unix)
  if (home) {
    const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm");
    try {
      const root = path.join(nvmDir, "versions", "node");
      for (const d of fs.readdirSync(root)) {
        if (d.startsWith("v20.")) candidates.push(path.join(root, d, "bin", exe));
      }
    } catch {}
  }

  // fnm
  const fnmDir = process.env.FNM_DIR || (home && path.join(home, ".fnm"));
  if (fnmDir) {
    try {
      const root = path.join(fnmDir, "node-versions");
      for (const d of fs.readdirSync(root)) {
        if (d.startsWith("v20.")) {
          candidates.push(path.join(root, d, "installation", exe));
          candidates.push(path.join(root, d, "installation", "bin", exe));
        }
      }
    } catch {}
  }

  // volta
  const voltaHome =
    process.env.VOLTA_HOME ||
    (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Volta")) ||
    (home && path.join(home, ".volta"));
  if (voltaHome) {
    try {
      const root = path.join(voltaHome, "tools", "image", "node");
      for (const d of fs.readdirSync(root)) {
        if (d.startsWith("20.")) {
          candidates.push(path.join(root, d, exe));
          candidates.push(path.join(root, d, "bin", exe));
        }
      }
    } catch {}
  }

  // system install
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\nodejs\\node.exe");
  } else {
    candidates.push("/usr/local/bin/node", "/opt/homebrew/bin/node");
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const ok = verifyNode20(c);
      if (ok) return ok;
    }
  }
  return null;
}

/**
 * If the parent Node is not 20.x, look for a Node 20 binary on disk and
 * prepend its directory to PATH on `childEnv`. Prints a one-line status
 * message to stdout. Returns the (possibly mutated) `childEnv`.
 *
 * `label` is shown in the status line, e.g. "[dev]" or "[bridge dev]".
 */
function pinNode20IntoEnv(childEnv, label = "[dev]") {
  const currentMajor = Number(process.versions.node.split(".")[0]);
  if (currentMajor === 20) return childEnv;

  const node20 = findNode20();
  if (node20) {
    const node20Dir = path.dirname(node20);
    // On Windows, process.env is case-insensitive but the env block passed
    // to CreateProcess is just a list of strings — if both `Path=…` and
    // `PATH=…` end up in the block, the first one wins and our prepend on
    // a different-cased key is silently ignored. Strip every PATH-like key
    // and set a single canonical one.
    let existing = "";
    for (const k of Object.keys(childEnv)) {
      if (k.toLowerCase() === "path") {
        if (!existing) existing = childEnv[k];
        delete childEnv[k];
      }
    }
    const canonicalKey = process.platform === "win32" ? "Path" : "PATH";
    childEnv[canonicalKey] = `${node20Dir}${path.delimiter}${existing}`;
    process.stdout.write(
      `${label} parent Node is ${process.version}; pinning children to Node 20 at ${node20Dir}\n`,
    );
  } else {
    process.stdout.write(
      `${label} WARN: running on ${process.version}, but project targets Node 20. ` +
        `Install Node 20 (e.g. \`scoop install nodejs20\`) for parity with Vercel.\n`,
    );
  }
  return childEnv;
}

module.exports = { findNode20, verifyNode20, pinNode20IntoEnv };
