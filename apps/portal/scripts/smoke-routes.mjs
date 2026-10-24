#!/usr/bin/env node
/**
 * Route x role smoke test for the client portal, against a RUNNING local dev
 * server. Mints a short-lived session for every clinic user straight in the
 * local DB, fetches every portal page as that user and flags:
 *   - non-2xx/3xx status, server error markers in the HTML
 *   - broken values in the visible text (NaN, undefined, Infinity,
 *     [object Object], Invalid Date)
 *   - cross-tenant access: another clinic's Anfrage id must not render
 * Minted sessions are deleted again at the end.
 *
 * Usage (from apps/portal):  node scripts/smoke-routes.mjs [baseUrl]
 * Default baseUrl: http://localhost:3007. Refuses to run against a
 * non-local DATABASE_URL.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { hkdfSync, randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { SignJWT } from "jose";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");

// .env.local wins over .env (same order as Next).
for (const file of [".env.local", ".env"]) {
  const p = path.join(appDir, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = (process.argv[2] ?? "http://localhost:3007").replace(/\/$/, "");
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL || !/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) {
  console.error("Refusing: DATABASE_URL is missing or not local.");
  process.exit(2);
}
const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  console.error("SESSION_SECRET missing.");
  process.exit(2);
}
const key = new Uint8Array(hkdfSync("sha256", SECRET, "eins-portal-v1", "session-v1", 32));

// Every static page.tsx under app/(portal), as a URL path.
function collectRoutes(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) {
      if (name === "page.tsx") out.push(prefix || "/");
      continue;
    }
    if (name.startsWith("_")) continue;
    const seg = name.startsWith("(") ? "" : `/${name}`;
    out.push(...collectRoutes(full, prefix + seg));
  }
  return out;
}
const portalDir = path.join(appDir, "src", "app", "(portal)");
const allRoutes = collectRoutes(portalDir).sort();
const staticRoutes = allRoutes.filter((r) => !r.includes("["));

const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
const minted = [];

async function mint(userId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await sql`
    INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
    VALUES (${userId}, ${tokenHash}, 'smoke-routes', now() + interval '1 hour')
    RETURNING id`;
  minted.push(row.id);
  return await new SignJWT({ sid: row.id, tok: token })
    .setProtectedHeader({ alg: "HS256", kid: "session-v1" })
    .setIssuedAt()
    .setExpirationTime("3600s")
    .sign(key);
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

const BAD_TEXT = [/\bNaN\b/, /\bundefined\b/, /\bInfinity\b/, /\[object Object\]/, /Invalid Date/, /\bnull\b €/];
const ERROR_MARKERS = [/Application error/i, /Unhandled Runtime Error/i, /Internal Server Error/i];

async function hit(cookie, route) {
  const t = performance.now();
  let status = 0;
  let body = "";
  let location = "";
  try {
    const res = await fetch(BASE + route, {
      headers: { cookie: `eins_session=${cookie}` },
      redirect: "manual",
    });
    status = res.status;
    location = res.headers.get("location") ?? "";
    body = await res.text();
  } catch (e) {
    return { route, status: "ERR", ms: 0, issues: [String(e.message ?? e)] };
  }
  const ms = Math.round(performance.now() - t);
  const issues = [];
  if (status >= 500) issues.push(`HTTP ${status}`);
  const text = visibleText(body);
  for (const re of BAD_TEXT) {
    const m = text.match(re);
    if (m) {
      const i = text.indexOf(m[0]);
      issues.push(`"${m[0]}" in: …${text.slice(Math.max(0, i - 60), i + 40).trim()}…`);
    }
  }
  for (const re of ERROR_MARKERS) if (re.test(body)) issues.push(`marker ${re}`);
  return { route, status, ms, bytes: body.length, location, issues, text, streamedNotFound: /NEXT_HTTP_ERROR_FALLBACK;404/.test(body) };
}

const users = await sql`
  SELECT u.id, u.email, u.role, u.clinic_id, c.display_name
  FROM clinic_users u JOIN clinics c ON c.id = u.clinic_id
  WHERE u.archived_at IS NULL
  ORDER BY c.display_name, u.role`;

const clinics = [...new Set(users.map((u) => u.clinic_id))];
const sampleRequest = new Map();
for (const c of clinics) {
  const [r] = await sql`SELECT id, message FROM requests WHERE clinic_id = ${c} ORDER BY created_at DESC LIMIT 1`;
  if (r) sampleRequest.set(c, { id: r.id, message: (r.message ?? "").trim() });
}

let failures = 0;
try {
  for (const u of users) {
    const cookie = await mint(u.id);
    const routes = [...staticRoutes];
    const own = sampleRequest.get(u.clinic_id)?.id;
    if (own) routes.push(`/anfragen/${own}`);
    console.log(`\n== ${u.display_name} | ${u.role} | ${u.email}`);
    for (const route of routes) {
      const r = await hit(cookie, route);
      const flag = r.issues.length ? "FAIL" : "ok  ";
      if (r.issues.length) failures++;
      const loc = r.location ? ` -> ${r.location.replace(BASE, "")}` : "";
      console.log(`${flag} ${String(r.status).padEnd(3)} ${String(r.ms).padStart(5)}ms ${route}${loc}`);
      for (const i of r.issues) console.log(`       ${i}`);
    }
    // Cross-tenant: every other clinic's Anfrage must not render.
    for (const [c, sample] of sampleRequest) {
      if (c === u.clinic_id) continue;
      const r = await hit(cookie, `/anfragen/${sample.id}`);
      // A 200 can be a streamed not-found page; a leak is the other clinic's content in the HTML.
      const shown = sample.message.length >= 8 && (r.text ?? "").includes(sample.message.slice(0, 60));
      const notFoundUi = r.streamedNotFound || /nicht gefunden/i.test(r.text ?? "");
      const ok = !shown && (r.status === 404 || (r.status >= 300 && r.status < 400) || (r.status === 200 && notFoundUi));
      if (!ok) failures++;
      const note = shown ? "  LEAK: other clinic's message rendered" : r.status === 200 ? (notFoundUi ? "  (not-found UI with status 200)" : "  200 without not-found UI") : "";
      console.log(`${ok ? "ok  " : "FAIL"} ${r.status} cross-tenant /anfragen/<${c.slice(0, 8)}>${note}`);
    }
  }
} finally {
  if (minted.length) await sql`DELETE FROM sessions WHERE id = ANY(${sql.array(minted)}::uuid[])`;
  await sql.end();
}
console.log(`\n${failures} failing checks. Dynamic routes not covered: ${allRoutes.filter((r) => r.includes("[") && !r.startsWith("/anfragen/")).join(", ") || "none"}`);
process.exit(failures ? 1 : 0);
