/**
 * One-off, prod-safe: give a single email a login on the existing demo clinic
 * ("Praxis Dr. Demo"). Idempotent — re-running just re-sets the password.
 *
 * Unlike src/db/seed.ts this NEVER truncates and writes exactly one
 * clinic_users row, so it is safe to run against production.
 *
 * Usage (prod, secrets injected by Infisical):
 *   infisical run --env=prod -- pnpm --filter portal exec tsx scripts/add-demo-login.ts
 *
 * Override target via env: DEMO_LOGIN_EMAIL, DEMO_LOGIN_NAME,
 * DEMO_LOGIN_ROLE (inhaber|marketing|frontdesk), DEMO_LOGIN_PASSWORD.
 */
import "../src/lib/load-env";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";

const EMAIL = (process.env.DEMO_LOGIN_EMAIL ?? "jheidenreich2204@outlook.com")
  .trim()
  .toLowerCase();
const FULL_NAME = process.env.DEMO_LOGIN_NAME ?? "Gast (Demo)";
const ROLE = process.env.DEMO_LOGIN_ROLE ?? "inhaber";
// Matches the seed's DEMO_PASSWORD so it lines up with the other demo accounts.
const PASSWORD = process.env.DEMO_LOGIN_PASSWORD ?? "DemoPasswort123!";

// The demo clinic's fixed id (src/db/seed.ts → DEMO_CLINIC_ID).
const DEMO_CLINIC_ID = "c7d88b71-72da-4920-b939-5158b13d3449";

async function main() {
  if (!["inhaber", "marketing", "frontdesk"].includes(ROLE)) {
    console.error(`✗ invalid DEMO_LOGIN_ROLE="${ROLE}"`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set (run via `infisical run --env=prod -- ...`)");
    process.exit(1);
  }

  // prepare:false so a single connection works against Neon's PgBouncer pooler
  // (transaction mode rejects prepared statements). Harmless on direct endpoints.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => void 0 });
  try {
    // Locate the demo clinic: prefer the fixed id, fall back to the well-known
    // display name so this still works if the prod row has a different id.
    const clinics = await sql<{ id: string; display_name: string }[]>`
      SELECT id, display_name
      FROM clinics
      WHERE id = ${DEMO_CLINIC_ID}
         OR display_name = 'Praxis Dr. Demo'
      ORDER BY (id = ${DEMO_CLINIC_ID}) DESC
      LIMIT 1
    `;
    const clinic = clinics[0];
    if (!clinic) {
      console.error(
        "✗ Demo clinic not found (no row with id=DEMO_CLINIC_ID or display_name='Praxis Dr. Demo'). Aborting — refusing to attach to a real clinic."
      );
      process.exit(1);
    }
    console.log(`→ demo clinic: ${clinic.display_name} (${clinic.id})`);

    const passwordHash = await argon2Hash(PASSWORD, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });

    const id = randomUUID();
    const rows = await sql<{ id: string; created: boolean }[]>`
      INSERT INTO clinic_users
        (id, clinic_id, email, full_name, role, password_hash, password_set_at)
      VALUES
        (${id}, ${clinic.id}, ${EMAIL}, ${FULL_NAME}, ${ROLE}, ${passwordHash}, now())
      ON CONFLICT ON CONSTRAINT clinic_users_email_unique DO UPDATE SET
        full_name     = EXCLUDED.full_name,
        role          = EXCLUDED.role,
        password_hash = EXCLUDED.password_hash,
        password_set_at = now(),
        archived_at   = NULL
      RETURNING id, (xmax = 0) AS created
    `;
    const row = rows[0]!;
    console.log(
      `✓ ${row.created ? "created" : "updated"} clinic_users row ${row.id}`
    );
    console.log("");
    console.log("  Login at: https://portal.eins.ag/login");
    console.log(`  E-Mail:   ${EMAIL}`);
    console.log(`  Passwort: ${PASSWORD}`);
    console.log(`  Rolle:    ${ROLE}  → Praxis Dr. Demo`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
