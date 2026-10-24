/**
 * One-shot setup for the clinic-landing → portal lead-mirror pipe.
 *
 * Does, in order:
 *   1. Runs `pnpm db:migrate` to apply any pending migrations.
 *   2. Ensures a portal `clinics` row exists for the given slug (default `_template`).
 *   3. Generates a fresh HMAC-SHA256 shared secret, encrypts it, upserts
 *      into `platform_credentials` with `platform='intake'`.
 *   4. Writes `PORTAL_URL` + `PORTAL_INTAKE_SECRET_<SLUG>` into the
 *      clinic-landing app's `.env.local` (creating/idempotent).
 *   5. If the matching `clinics/<slug>/clinic.ts` still has the placeholder
 *      `portalClinicId: ""`, patches it to the real UUID.
 *
 * Invoke from apps/portal:
 *
 *     pnpm setup:intake               # defaults to slug=_template
 *     pnpm setup:intake my-praxis     # custom slug (Praxis must exist: Admin, "Neue Praxis")
 *     pnpm setup:intake my-praxis --rotate          # issue a NEW secret
 *     pnpm setup:intake my-praxis --portal-url=https://app.eins.ag
 *
 * Re-runnable (G-02): an existing secret is reused, not rotated, unless
 * `--rotate` is passed. PORTAL_URL comes from `--portal-url`, else
 * APP_ORIGIN, else http://localhost:3001. The secret and the clinic UUID are
 * printed at the end so they can be entered in Vercel (clinic-landing) when
 * DATABASE_URL points at production.
 */

import "../lib/load-env";
import { execSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "_template";
const rotate = args.includes("--rotate");
const portalUrl = (
  args.find((a) => a.startsWith("--portal-url="))?.slice("--portal-url=".length) ??
  process.env.APP_ORIGIN ??
  "http://localhost:3001"
).replace(/\/+$/, "");

/**
 * Inline AES-256-GCM encryption. Mirrors src/lib/crypto.ts:encryptString;
 * inlined here because that module is marked `server-only`, which tsx
 * (rightly) refuses to load outside of a request context.
 */
function encryptString(plaintext: string): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes hex (64 chars)");
  }
  const key = Buffer.from(hexKey, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decryptString(blob: Buffer): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
}

function dbHostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unbekannt)";
  }
}

function envVarNameForSlug(s: string): string {
  // _template → PORTAL_INTAKE_SECRET_TEMPLATE
  // praxis-mueller-muenchen → PORTAL_INTAKE_SECRET_PRAXIS_MUELLER_MUENCHEN
  const upper = s.replace(/^_+/, "").toUpperCase().replace(/-/g, "_");
  return `PORTAL_INTAKE_SECRET_${upper}`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n══ Lead-intake setup for clinic "${slug}" ══\n`);

  // 1. Migrations
  console.log("→ Applying pending migrations…");
  execSync("pnpm db:migrate", { stdio: "inherit", cwd: process.cwd() });

  // 2. DB connection
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => void 0 });
  const dbHost = dbHostLabel(url);
  const localDb = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(dbHost);
  console.log(`→ Datenbank: ${dbHost}${localDb ? " (lokal)" : " (NICHT lokal)"}`);

  try {
    // 3. Upsert clinic
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM clinics WHERE slug = ${slug} LIMIT 1
    `;
    let clinicId: string;
    if (existing.length === 0 && slug !== "_template") {
      // G-02: a Praxis is created in the admin ("Neue Praxis"), never here,
      // so the UUID in clinic.ts always belongs to the database it runs on.
      console.error(
        `✗ Keine Praxis mit slug "${slug}" in ${dbHost}. Erst im Admin unter "Neue Praxis" anlegen.`
      );
      process.exit(1);
    }
    if (existing.length === 0) {
      const displayName = slug === "_template" ? "Praxis Dr. Demo" : slug;
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO clinics (legal_name, display_name, slug)
        VALUES (${displayName}, ${displayName}, ${slug})
        RETURNING id
      `;
      clinicId = inserted[0]!.id;
      console.log(`→ Created portal clinic "${slug}" (${clinicId})`);
    } else {
      clinicId = existing[0]!.id;
      console.log(`→ Found existing portal clinic "${slug}" (${clinicId})`);
    }

    // 3b. Seed the default Fortschritt-Journey from the central template so the
    // Praxis opens the Fortschritt tab to a clear plan, not an empty tab.
    // Idempotent via NOT EXISTS: skipped if the clinic already has entries, so
    // re-running setup:intake never duplicates. Inlined here (not the
    // server-only applyDefaultJourney helper) because tsx refuses server-only.
    const seeded = await sql<{ id: string }[]>`
      INSERT INTO clinic_timeline_entries (
        clinic_id, title, description, phase_label, sort_order, status, created_by_email
      )
      SELECT
        ${clinicId}, title, description, phase_label, sort_order, default_status,
        'team@eins.ag'
      FROM timeline_default_steps
      WHERE is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM clinic_timeline_entries WHERE clinic_id = ${clinicId}
        )
      ORDER BY sort_order
      RETURNING id
    `;
    if (seeded.length > 0) {
      console.log(`→ Seeded Standard-Journey (${seeded.length} Schritte) into Fortschritt`);
    } else {
      console.log(`· Fortschritt already has entries — Standard-Journey left as-is`);
    }

    // 4. Reuse the existing secret unless --rotate (G-02: a second run used
    // to rotate it silently and break the Zielseite already deployed with
    // the old one).
    const current = await sql<{ access_token_enc: Buffer | null }[]>`
      SELECT access_token_enc FROM platform_credentials
      WHERE clinic_id = ${clinicId} AND platform = 'intake' LIMIT 1
    `;
    let plaintext: string | null = null;
    if (current[0]?.access_token_enc && !rotate) {
      try {
        plaintext = decryptString(Buffer.from(current[0].access_token_enc));
        console.log("→ Vorhandenes Intake-Secret wiederverwendet (neues nur mit --rotate)");
      } catch {
        console.error(
          "✗ Vorhandenes Secret lässt sich mit diesem ENCRYPTION_KEY nicht entschlüsseln. Mit --rotate neu ausstellen."
        );
        process.exit(1);
      }
    } else {
      plaintext = randomBytes(32).toString("hex");
      const ciphertext = encryptString(plaintext);
      await sql`
        INSERT INTO platform_credentials (clinic_id, platform, access_token_enc)
        VALUES (${clinicId}, 'intake', ${ciphertext})
        ON CONFLICT (clinic_id, platform)
          DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc
      `;
      console.log(
        current.length > 0
          ? "→ Intake-Secret ROTIERT: die alte Zielseiten-Variable gilt ab jetzt nicht mehr"
          : "→ Neues Intake-Secret angelegt"
      );
    }

    // 5. Update clinic-landing .env.local
    // process.cwd() is apps/portal when invoked via pnpm script.
    const repoRoot = path.resolve(process.cwd(), "../..");
    const envPath = path.join(repoRoot, "apps/clinic-landing/.env.local");
    const envVar = envVarNameForSlug(slug);

    let envContent = (await fileExists(envPath))
      ? await readFile(envPath, "utf8")
      : "";

    const lines = envContent.split(/\r?\n/);
    // Drop our own previous block: the header comment plus the two var lines.
    // Header lines that aren't ours are preserved.
    const filtered = lines.filter(
      (line) =>
        line.trim() !== "# EINS Portal lead mirror" &&
        !line.trim().startsWith("PORTAL_URL=") &&
        !line.trim().startsWith(`${envVar}=`)
    );
    // Drop trailing empty lines to keep formatting tight.
    while (filtered.length > 0 && filtered[filtered.length - 1]!.trim() === "") {
      filtered.pop();
    }
    if (filtered.length > 0) filtered.push("");
    filtered.push("# EINS Portal lead mirror");
    filtered.push(`PORTAL_URL=${portalUrl}`);
    filtered.push(`${envVar}=${plaintext}`);
    filtered.push("");
    await writeFile(envPath, filtered.join("\n"), "utf8");
    console.log(`→ Updated apps/clinic-landing/.env.local`);

    // 6. Patch clinic.ts portalClinicId placeholder
    const clinicTsPath = path.join(
      repoRoot,
      "apps/clinic-landing/clinics",
      slug,
      "clinic.ts"
    );
    if (await fileExists(clinicTsPath)) {
      const src = await readFile(clinicTsPath, "utf8");
      if (src.includes('portalClinicId: ""')) {
        const next = src.replace(
          'portalClinicId: ""',
          `portalClinicId: "${clinicId}"`
        );
        await writeFile(clinicTsPath, next, "utf8");
        console.log(`→ Patched apps/clinic-landing/clinics/${slug}/clinic.ts`);
      } else {
        console.log(
          `· apps/clinic-landing/clinics/${slug}/clinic.ts already has a portalClinicId (left as-is)`
        );
      }
    } else {
      console.log(
        `· No clinic.ts for slug "${slug}" — set portalClinicId: "${clinicId}" manually when you create it.`
      );
    }

    console.log("\n✓ Done.\n");
    console.log("Werte für clinic-landing (bei Produktion in Vercel eintragen):");
    console.log(`  PORTAL_URL=${portalUrl}`);
    console.log(`  ${envVar}=${plaintext}`);
    console.log(`  portalClinicId: "${clinicId}"   (Datenbank ${dbHost})\n`);
    console.log("Next steps:");
    console.log("  1. Start the portal:        pnpm dev          (from apps/portal)");
    console.log("  2. Start clinic-landing:    pnpm dev          (from apps/clinic-landing)");
    console.log("  3. Start the worker:        pnpm worker       (from apps/portal)");
    console.log(`  4. Submit the form on ${slug}/<treatment-slug>`);
    console.log("  5. Watch leads land at http://localhost:3001/anfragen\n");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\n✗ Setup failed:", err);
  process.exit(1);
});
