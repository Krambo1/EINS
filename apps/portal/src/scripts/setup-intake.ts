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
 *     pnpm setup:intake my-praxis     # custom slug
 *
 * Re-runnable. Re-running rotates the HMAC secret.
 */

import "../lib/load-env";
import { execSync } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const slug = process.argv[2] ?? "_template";

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

  try {
    // 3. Upsert clinic
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM clinics WHERE slug = ${slug} LIMIT 1
    `;
    let clinicId: string;
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

    // 4. Generate + encrypt + upsert HMAC secret
    const plaintext = randomBytes(32).toString("hex");
    const ciphertext = encryptString(plaintext);
    await sql`
      INSERT INTO platform_credentials (clinic_id, platform, access_token_enc)
      VALUES (${clinicId}, 'intake', ${ciphertext})
      ON CONFLICT (clinic_id, platform)
        DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc
    `;
    console.log(`→ Wrote intake credential to platform_credentials`);

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
    filtered.push("PORTAL_URL=http://localhost:3001");
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
