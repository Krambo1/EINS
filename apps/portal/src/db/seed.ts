/**
 * Seed script — inserts a demo clinic "Praxis Dr. Demo" with three clinic
 * users (inhaber / marketing / frontdesk), treatments, locations, documents
 * and connected ad-platform credentials, then its activity from
 * `demo-data.ts` (~80 Anfragen weighted into the last 30 days, 365 days of
 * campaign snapshots and KPI rollups, goals, posts, the progress timeline).
 * The live demo Praxis renews that activity with
 * `scripts/refresh-demo-data.ts`.
 *
 * The admin user (Karam) comes from ADMIN_EMAILS env and is created
 * on-demand by the admin login flow.
 *
 * Runs on the SUPERUSER connection; bypasses RLS.
 */

import "../lib/load-env";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";
import { TREATMENT_CATEGORIES, insertDemoActivity } from "./demo-data";

/**
 * Dev-only Default-Passwort für alle Demo-Seed-User. Stimmt mit dem RUN.md
 * überein, damit Karam nach `pnpm db:seed` direkt mit Passwort einloggen
 * kann ohne Magic-Link Theater.
 */
const DEMO_PASSWORD = "DemoPasswort123!";

/**
 * Fixed UUID for the demo clinic so the landing-app template
 * (`apps/clinic-landing/clinics/_template/clinic.ts`) can hardcode its
 * `portalClinicId` and survive re-seeds. Must match that file.
 */
const DEMO_CLINIC_ID = "c7d88b71-72da-4920-b939-5158b13d3449";

/**
 * Second demo clinic: a freshly onboarded Praxis on day one. Empty dashboard /
 * Anfragen (nothing has happened yet) but a populated Fortschritt tab showing
 * the default, forward-looking step journey copied from `timeline_default_steps`
 * (relative phases, no dates). Demonstrates exactly what a new client sees the
 * moment they log in. Fixed UUID so re-seeds and admin impersonation are stable.
 */
const DEMO_NEW_CLINIC_ID = "d1e2f3a4-b5c6-4d7e-8f90-1a2b3c4d5e6f";

async function main() {
  // Hard guard: this script writes accounts with the well-known DEMO_PASSWORD
  // and TRUNCATEs every clinic-scoped table. Running it against a production
  // database would either nuke real data or seed three trivially-known
  // credentials. Bail out before any side-effect.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "✗ seed.ts darf nicht in Produktion laufen — DEMO_PASSWORD wäre eine known credential und TRUNCATE würde Echtdaten löschen."
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => void 0 });

  try {
    console.log("→ seeding demo clinic ...");

    // Wipe previous demo data (safe since it's local dev).
    // TRUNCATE ... CASCADE follows FK references transitively, regardless of
    // whether each individual FK was declared with ON DELETE CASCADE. This
    // wipes all clinic-scoped tables (requests, campaign_snapshots, goals,
    // animations, documents, audit_logs, etc.) but leaves admin-only tables
    // (admin_users, etc.) untouched since they don't reference clinics.
    await sql`TRUNCATE clinics RESTART IDENTITY CASCADE`;

    const clinicId = DEMO_CLINIC_ID;
    await sql`
      INSERT INTO clinics (id, legal_name, display_name, slug, default_doctor_email, hwg_contact_name, hwg_contact_email)
      VALUES (
        ${clinicId},
        'Praxis Dr. Demo GmbH',
        'Praxis Dr. Demo',
        '_template',
        'dr.demo@example.com',
        'Dr. Martin Demo',
        'hwg@example.com'
      )
    `;

    // --- users ---
    const inhaberId = randomUUID();
    const marketingId = randomUUID();
    const frontdeskId = randomUUID();
    // Default-Passwort wird gesetzt, damit `pnpm db:seed` einen
    // sofort-loginfähigen Account produziert. Siehe DEMO_PASSWORD oben + RUN.md.
    const demoHash = await argon2Hash(DEMO_PASSWORD, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });
    await sql`
      INSERT INTO clinic_users (id, clinic_id, email, full_name, role, password_hash, password_set_at, last_login_at)
      VALUES
        (${inhaberId},   ${clinicId}, 'inhaber@praxis-demo.de',   'Dr. Martin Demo', 'inhaber',   ${demoHash}, now(), now() - interval '2 hours'),
        (${marketingId}, ${clinicId}, 'marketing@praxis-demo.de', 'Lisa Werbung',     'marketing', ${demoHash}, now(), now() - interval '1 day'),
        (${frontdeskId}, ${clinicId}, 'frontdesk@praxis-demo.de', 'Sabine Empfang',   'frontdesk', ${demoHash}, now(), now() - interval '3 hours')
    `;

    // --- treatments (per-clinic categories) ---
    const treatmentIdBySlug: Record<string, string> = {};
    for (let i = 0; i < TREATMENT_CATEGORIES.length; i++) {
      const cat = TREATMENT_CATEGORIES[i]!;
      const id = randomUUID();
      treatmentIdBySlug[cat.slug] = id;
      await sql`
        INSERT INTO treatments (id, clinic_id, name, slug, display_order, keywords)
        VALUES (${id}, ${clinicId}, ${cat.name}, ${cat.slug}, ${i}, ${cat.keywords})
      `;
    }

    // --- locations (1 primary + 1 secondary so multi-location UI surfaces) ---
    const primaryLocationId = randomUUID();
    const secondaryLocationId = randomUUID();
    await sql`
      INSERT INTO locations (id, clinic_id, name, address, is_primary, display_order)
      VALUES
        (${primaryLocationId},   ${clinicId}, 'München Hauptpraxis', 'Maximilianstraße 12, 80539 München',  true,  0),
        (${secondaryLocationId}, ${clinicId}, 'München Bogenhausen', 'Prinzregentenstraße 99, 81675 München', false, 1)
    `;

    // --- the Praxis's activity (Anfragen, KPIs, posts, ...) ---
    const activity = await insertDemoActivity(sql, {
      clinicId,
      inhaberId,
      marketingId,
      frontdeskId,
      treatmentIdBySlug,
      primaryLocationId,
      secondaryLocationId,
      reviewSchedule: true,
    });


    // --- animation library (global) ---
    await sql`DELETE FROM animation_library WHERE title IN ('Botox Standard','Hyaluron Lippen','Laser Haarentfernung','Kryolipolyse Bauch')`;
    const animIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await sql`
      INSERT INTO animation_library (id, title, treatment_tag, description, storage_key_master, duration_s)
      VALUES
        (${animIds[0]!}, 'Botox Standard', 'botox',
           'Erklär-Animation zu Botox-Behandlungen, 15s: Wirkung, Ablauf und Nachsorge.',
           'global/animations/botox-standard.mp4', 15),
        (${animIds[1]!}, 'Hyaluron Lippen', 'hyaluron',
           'Erklär-Animation zur Hyaluron-Lippenbehandlung, 20s: Ablauf und Nachsorge.',
           'global/animations/hyaluron-lippen.mp4', 20),
        (${animIds[2]!}, 'Laser Haarentfernung', 'laser',
           'Vorteil-Ersichtliches-Erklärvideo für Laser-Behandlungen, 18s.',
           'global/animations/laser-haare.mp4', 18),
        (${animIds[3]!}, 'Kryolipolyse Bauch', 'kryolipolyse',
           '22s-Video, Fokus auf Bauchbereich + Komfort-Aspekt.',
           'global/animations/kryolipolyse-bauch.mp4', 22)
    `;

    // Default animation_instance for each library entry (status 'standard')
    for (const libId of animIds) {
      await sql`
        INSERT INTO animation_instances (clinic_id, library_id, status)
        VALUES (${clinicId}, ${libId}, 'standard')
        ON CONFLICT (clinic_id, library_id) DO NOTHING
      `;
    }

    // --- Vertriebsleitfaden PDF: generate the COMPLETE playbook from the
    // single source of truth (leitfaden/content.ts) and publish it as a real,
    // downloadable document. This is the exact buffer the page's "vollständige
    // PDF" link resolves to, so what staff download can never drift from the
    // page.
    //
    // We write straight to the local storage driver's directory rather than
    // importing `@/server/storage`: that module begins with `import
    // "server-only"`, which throws under tsx (this seed's runner). The seed is
    // hard-guarded to dev only (see the NODE_ENV check at the top), where the
    // local driver is always active, so this inline write is equivalent to
    // getStorage().put(leitfadenKey, pdf) here.
    const { generateLeitfadenPdf } = await import(
      "../server/reports/leitfaden-pdf"
    );
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname, join, resolve: resolvePath } = await import("node:path");
    const leitfadenKey = "global/vertriebsleitfaden.pdf";
    const leitfadenPdf = await generateLeitfadenPdf();
    const leitfadenPath = join(
      resolvePath(process.cwd(), "storage"),
      leitfadenKey
    );
    await mkdir(dirname(leitfadenPath), { recursive: true });
    await writeFile(leitfadenPath, leitfadenPdf);

    // --- documents (vertrag/avv are placeholder keys; the Vertriebsleitfaden
    // row below points at the freshly generated file). No monthly report:
    // the Übersicht is the monthly Auswertung. ---
    await sql`
      INSERT INTO documents (clinic_id, kind, title, storage_key, visible_to_roles)
      VALUES
        (${clinicId}, 'vertrag',              'Hauptvertrag EINS',                                    'clinics/praxis-dr-demo/vertrag-2026.pdf',                ARRAY['inhaber']::text[]),
        (${clinicId}, 'avv',                  'Auftragsverarbeitungsvertrag',                         'clinics/praxis-dr-demo/avv-2026.pdf',                    ARRAY['inhaber']::text[])
    `;
    await sql`
      INSERT INTO documents (clinic_id, kind, title, storage_key, file_size_bytes, visible_to_roles)
      VALUES (
        ${clinicId},
        'vertriebsleitfaden',
        'Vertriebsleitfaden (komplettes Playbook)',
        ${leitfadenKey},
        ${leitfadenPdf.byteLength},
        ARRAY['inhaber','marketing','frontdesk']::text[]
      )
    `;


    // --- platform_credentials (Werbekonten card in Einstellungen) ---
    // Bytea field is NOT NULL but never decrypted in dev — a labelled placeholder
    // keeps the row valid without exposing a fake secret.
    const placeholderToken = Buffer.from("DEMO_TOKEN_NOT_REAL", "utf8");
    await sql`
      INSERT INTO platform_credentials (
        clinic_id, platform, access_token_enc, account_id,
        last_synced_at, scopes
      )
      VALUES
        (${clinicId}, 'meta',   ${placeholderToken}, 'act_283719456',
         now() - interval '47 minutes',
         ARRAY['ads_read','ads_management','business_management']::text[]),
        (${clinicId}, 'google', ${placeholderToken}, '987-654-3210',
         now() - interval '1 hour 12 minutes',
         ARRAY['https://www.googleapis.com/auth/adwords']::text[])
      ON CONFLICT (clinic_id, platform) DO NOTHING
    `;


    console.log(`✓ seeded clinic ${clinicId} (Praxis Dr. Demo)`);
    console.log(`  inhaber:    inhaber@praxis-demo.de`);
    console.log(`  marketing:  marketing@praxis-demo.de`);
    console.log(`  frontdesk:  frontdesk@praxis-demo.de`);
    console.log(`  Anfragen:   ${activity.requestCount} (${activity.newCount} neu, Schwerpunkt in den letzten 30 Tagen)`);
    console.log(`  KPI-Tage:   365`);
    console.log(`  Werbekonten: meta + google verbunden (Demo-Token)`);
    console.log(`  Beiträge:    ${activity.postCount} (jeder Status, 2 warten auf Freigabe, davon 1 nur für die Inhaberin)`);
    for (const link of activity.openLinks) console.log(`  Freigabe-Link: ${link}`);
    console.log(
      `  Leitfaden:   ${leitfadenPdf.byteLength.toLocaleString("de-DE")} Bytes PDF → ${leitfadenKey} (Dokumente)`
    );

    // ---------------------------------------------------------------
    // Second demo clinic: a brand-new onboarded Praxis (day one). Minimal on
    // purpose — one inhaber account, no Anfragen/KPIs (an empty clinic is the
    // realistic day-one state) — but a populated Fortschritt tab seeded from the
    // default-journey template. This is the "what a new client sees" preview.
    // ---------------------------------------------------------------
    const newClinicId = DEMO_NEW_CLINIC_ID;
    const newInhaberId = randomUUID();
    await sql`
      INSERT INTO clinics (id, legal_name, display_name, slug, default_doctor_email, hwg_contact_name, hwg_contact_email)
      VALUES (
        ${newClinicId},
        'Praxis Dr. Neu GmbH',
        'Praxis Dr. Neu',
        'praxis-neu',
        'dr.neu@example.com',
        'Dr. Nadine Neu',
        'hwg@praxis-neu.de'
      )
    `;
    await sql`
      INSERT INTO clinic_users (id, clinic_id, email, full_name, role, password_hash, password_set_at, last_login_at)
      VALUES
        (${newInhaberId}, ${newClinicId}, 'inhaber@praxis-neu.de', 'Dr. Nadine Neu', 'inhaber', ${demoHash}, now(), NULL)
    `;
    // Copy the default journey from the central template → this clinic's
    // Fortschritt feed. event_date stays NULL (relative phases); status comes
    // from the template's default_status (step 1 "laeuft", rest "geplant").
    // This is the same copy the auto-seed / admin button will perform.
    await sql`
      INSERT INTO clinic_timeline_entries (
        clinic_id, title, description, phase_label, sort_order, status, created_by_email
      )
      SELECT ${newClinicId}, title, description, phase_label, sort_order, default_status, 'team@eins.ag'
      FROM timeline_default_steps
      WHERE is_active = true
      ORDER BY sort_order
    `;
    console.log(`✓ seeded clinic ${newClinicId} (Praxis Dr. Neu — Tag 1)`);
    console.log(`  inhaber:    inhaber@praxis-neu.de`);
    console.log(`  Fortschritt: Standard-Journey (10 Schritte, relative Phasen)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
