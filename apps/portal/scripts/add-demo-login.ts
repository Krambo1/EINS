/**
 * One-off, prod-safe: give a single email a login on the existing demo clinic
 * ("Praxis Dr. Demo"). Idempotent — re-running just re-sets the password.
 *
 * Unlike src/db/seed.ts this NEVER truncates and writes exactly one
 * clinic_users row, so it is safe to run against production.
 *
 * DEMO_LOGIN_PASSWORD is REQUIRED (no default) — the script fails closed if it
 * is unset. Production runs additionally require DEMO_LOGIN_ALLOW_PROD=1 as an
 * explicit opt-in, since the default behaviour must never be to provision an
 * owner login against prod.
 *
 * Usage (prod, secrets injected by Infisical):
 *   infisical run --env=prod -- env DEMO_LOGIN_ALLOW_PROD=1 \
 *     pnpm --filter portal exec tsx scripts/add-demo-login.ts
 *
 * Override target via env: DEMO_LOGIN_EMAIL, DEMO_LOGIN_NAME,
 * DEMO_LOGIN_ROLE (inhaber|marketing|frontdesk). DEMO_LOGIN_PASSWORD is required.
 */
import "../src/lib/load-env";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";

// EMAIL and ROLE are REQUIRED — no privileged defaults. A default
// `inhaber` + a default personal email meant the bare invocation provisioned
// an owner-level login (and leaked PII into git history); both are now
// explicit (pentest H2/CS-02).
const EMAIL = process.env.DEMO_LOGIN_EMAIL?.trim().toLowerCase();
const FULL_NAME = process.env.DEMO_LOGIN_NAME ?? "Gast (Demo)";
const ROLE = process.env.DEMO_LOGIN_ROLE;
// Required, no default: a hardcoded fallback would ship a known credential for
// an owner (inhaber) account. Unset → fail closed in main().
const PASSWORD = process.env.DEMO_LOGIN_PASSWORD;

// The demo clinic's fixed id (src/db/seed.ts → DEMO_CLINIC_ID).
const DEMO_CLINIC_ID = "c7d88b71-72da-4920-b939-5158b13d3449";

async function main() {
  // Prod guard: provisioning an owner (inhaber) login against production must be
  // an explicit, deliberate act — never the default. Mirrors src/db/seed.ts.
  if (process.env.NODE_ENV === "production" && process.env.DEMO_LOGIN_ALLOW_PROD !== "1") {
    console.error(
      "✗ add-demo-login.ts läuft in Produktion nur mit DEMO_LOGIN_ALLOW_PROD=1 (expliziter Opt-in). Abbruch."
    );
    process.exit(1);
  }

  if (!EMAIL) {
    console.error("✗ DEMO_LOGIN_EMAIL is not set (required, no default)");
    process.exit(1);
  }
  if (!ROLE || !["inhaber", "marketing", "frontdesk"].includes(ROLE)) {
    console.error(
      `✗ DEMO_LOGIN_ROLE must be one of inhaber|marketing|frontdesk (got "${ROLE ?? ""}")`
    );
    process.exit(1);
  }

  if (!PASSWORD) {
    console.error("✗ DEMO_LOGIN_PASSWORD is not set (required, no default — fail closed)");
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
        password_set_at = now()
      RETURNING id, (xmax = 0) AS created
    `;
    const row = rows[0]!;

    // Audit trail: this script mints/updates a clinic login on the superuser
    // DSN; without a row the action is invisible to the Praxis (pentest
    // H2/CS-02). entity_id is the affected clinic_users row.
    await sql`
      INSERT INTO audit_log (clinic_id, actor_email, action, entity_kind, entity_id, diff)
      VALUES (
        ${clinic.id}, ${EMAIL}, ${row.created ? "create" : "update"},
        'clinic_user', ${row.id},
        ${sql.json({ via: "scripts/add-demo-login.ts", role: ROLE })}
      )
    `;
    console.log(
      `✓ ${row.created ? "created" : "updated"} clinic_users row ${row.id}`
    );
    console.log("");
    console.log("  Login at: https://portal.eins.ag/login");
    console.log(`  E-Mail:   ${EMAIL}`);
    console.log("  Passwort: (gesetzt über DEMO_LOGIN_PASSWORD)");
    console.log(`  Rolle:    ${ROLE}  → Praxis Dr. Demo`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
