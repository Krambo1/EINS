#!/usr/bin/env node
/**
 * Load-test data for the LOCAL portal database (performance review W5).
 *
 *   node scripts/seed-load.mjs seed    # 1 big Praxis + 49 small ones
 *   node scripts/seed-load.mjs clean   # removes exactly the lasttest-* Praxen
 *
 * Every clinic created here has slug and display_name starting with
 * "lasttest-"; `clean` deletes only rows that belong to those clinics (and
 * users/sessions of their users). Refuses to run unless DATABASE_URL points
 * at localhost. Run from apps/portal.
 *
 *   lasttest-gross: inhaber@lasttest-gross.invalid, 20.000 Anfragen over 24 months
 *   lasttest-01..49: 50-500 Anfragen each
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
for (const file of [".env.local", ".env"]) {
  const p = path.join(appDir, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL || !/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) {
  console.error("Refusing: DATABASE_URL is missing or not local.");
  process.exit(2);
}
const mode = process.argv[2];
if (mode !== "seed" && mode !== "clean") {
  console.error("Usage: node scripts/seed-load.mjs seed|clean");
  process.exit(2);
}

const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
const PREFIX = "lasttest-";
const TREATMENTS = [
  ["Botox", "botox"],
  ["Hyaluron-Filler", "hyaluron"],
  ["Lippenunterspritzung", "lippen"],
  ["Brustvergroesserung", "brust"],
  ["Nasenkorrektur", "nase"],
  ["Faltenunterspritzung", "falten"],
  ["Fettabsaugung", "fett"],
  ["Laserbehandlung", "laser"],
];

async function seedClinic({ slug, name, n, big }) {
  const [clinic] = await sql`
    INSERT INTO clinics (legal_name, display_name, slug)
    VALUES (${name + " GmbH"}, ${name}, ${slug}) RETURNING id`;
  const clinicId = clinic.id;

  const users = big
    ? [["inhaber", "Inhaber"], ["marketing", "Marketing"], ["frontdesk", "Empfang"]]
    : [["inhaber", "Inhaber"]];
  const userIds = [];
  for (const [role, label] of users) {
    const [u] = await sql`
      INSERT INTO clinic_users (clinic_id, email, full_name, role)
      VALUES (${clinicId}, ${role + "@" + slug + ".invalid"}, ${label + " " + name}, ${role})
      RETURNING id`;
    userIds.push(u.id);
  }
  const actorIds = userIds;

  for (let i = 0; i < TREATMENTS.length; i++) {
    await sql`INSERT INTO treatments (clinic_id, name, slug, display_order)
              VALUES (${clinicId}, ${TREATMENTS[i][0]}, ${TREATMENTS[i][1]}, ${i})`;
  }
  const nLoc = big ? 3 : 1;
  for (let i = 0; i < nLoc; i++) {
    await sql`INSERT INTO locations (clinic_id, name, address, is_primary, display_order)
              VALUES (${clinicId}, ${"Standort " + (i + 1)}, ${"Teststrasse " + (i + 1) + ", Berlin"}, ${i === 0}, ${i})`;
  }

  // Patients: 60 % of the Anfragen link to a patient.
  const nPat = Math.floor(n * 0.6);
  for (let lo = 1; lo <= nPat; lo += 5000) {
    const hi = Math.min(nPat, lo + 4999);
    await sql`
      INSERT INTO patients (clinic_id, email, phone, full_name, first_seen_at, last_seen_at, first_touch_source)
      SELECT ${clinicId}, 'p' || g || '@' || ${slug} || '.invalid', '+4915' || lpad(g::text, 9, '0'),
             'Patient Testmann ' || g,
             now() - (random() * interval '700 days'), now() - (random() * interval '100 days'),
             (ARRAY['meta','google','formular','intake'])[1 + floor(random()*4)::int]
      FROM generate_series(${lo}::int, ${hi}::int) g`;
  }

  // Anfragen, in chunks.
  const CHUNK = 5000;
  for (let lo = 1; lo <= n; lo += CHUNK) {
    const hi = Math.min(n, lo + CHUNK - 1);
    await sql`
      WITH ctx AS (
        SELECT (SELECT array_agg(id) FROM patients WHERE clinic_id = ${clinicId}) AS pats,
               (SELECT array_agg(id) FROM treatments WHERE clinic_id = ${clinicId}) AS treats,
               (SELECT array_agg(id) FROM locations WHERE clinic_id = ${clinicId}) AS locs,
               ${actorIds}::uuid[] AS actors
      ), g AS (
        SELECT i, power(random(), 1.5) * 730 AS days_ago, random() AS r_status, random() AS r_src,
               random() AS r_score, random() AS r_pat, random() AS r_tr, random() AS r_t1, random() AS r_rev
        FROM generate_series(${lo}::int, ${hi}::int) i
      ), b AS (
        SELECT g.*, now() - (g.days_ago * interval '1 day') AS created,
          CASE
            WHEN g.days_ago < 2 THEN CASE WHEN r_status < 0.70 THEN 'neu' WHEN r_status < 0.90 THEN 'kontaktiert' ELSE 'nicht_erreicht' END
            WHEN g.days_ago < 14 THEN CASE WHEN r_status < 0.25 THEN 'neu' WHEN r_status < 0.45 THEN 'kontaktiert' WHEN r_status < 0.58 THEN 'nicht_erreicht'
                                           WHEN r_status < 0.70 THEN 'termin_vereinbart' WHEN r_status < 0.80 THEN 'beratung_erschienen' WHEN r_status < 0.88 THEN 'verloren' WHEN r_status < 0.94 THEN 'spam' ELSE 'gewonnen' END
            ELSE CASE WHEN r_status < 0.03 THEN 'neu' WHEN r_status < 0.06 THEN 'kontaktiert' WHEN r_status < 0.10 THEN 'nicht_erreicht'
                      WHEN r_status < 0.14 THEN 'termin_vereinbart' WHEN r_status < 0.20 THEN 'beratung_erschienen' WHEN r_status < 0.26 THEN 'no_show'
                      WHEN r_status < 0.40 THEN 'behandelt' WHEN r_status < 0.58 THEN 'gewonnen' WHEN r_status < 0.88 THEN 'verloren' ELSE 'spam' END
          END AS st,
          (ARRAY['meta','meta','meta','google','google','formular','formular','intake','manuell','instagram'])[1 + floor(r_src*10)::int] AS src,
          CASE WHEN r_score < 0.15 THEN NULL ELSE floor(r_score * 118)::int END AS raw_score
        FROM g
      )
      INSERT INTO requests (clinic_id, source, source_campaign_id, utm, contact_name, contact_email, contact_phone,
                            treatment_wish, treatment_id, patient_id, location_id, budget_indication, message,
                            ai_score, ai_category, ai_reasoning, ai_signals, status, assigned_to, converted_revenue_eur,
                            sla_respond_by, created_at, first_contacted_at, first_viewed_at, won_at, raw_payload)
      SELECT ${clinicId}, b.src,
             CASE WHEN b.src IN ('meta','google') THEN 'camp-' || (b.i % 12) END,
             jsonb_build_object('utm_source', b.src, 'utm_campaign', 'kampagne-' || (b.i % 12), 'utm_medium', 'cpc'),
             'Anfrage Kontakt ' || b.i, 'k' || b.i || '@' || ${slug} || '.invalid', '+4917' || lpad(b.i::text, 9, '0'),
             (ARRAY['Botox','Filler','Lippen','Brust','Nase','Falten','Fett','Laser'])[1 + (b.i % 8)],
             ctx.treats[1 + floor(b.r_tr * array_length(ctx.treats,1))::int],
             CASE WHEN b.r_pat < 0.6 AND ctx.pats IS NOT NULL THEN ctx.pats[1 + floor(random() * array_length(ctx.pats,1))::int] END,
             CASE WHEN ctx.locs IS NOT NULL THEN ctx.locs[1 + (b.i % array_length(ctx.locs,1))] END,
             (ARRAY['unter 1.500','1.500-5.000','5.000-10.000','ueber 10.000'])[1 + (b.i % 4)],
             'Guten Tag, ich interessiere mich fuer eine Behandlung und haette gern einen Beratungstermin. ' || repeat('Weitere Angaben zu meinem Anliegen. ', 3),
             LEAST(b.raw_score, 100),
             CASE WHEN b.raw_score IS NULL THEN NULL WHEN b.raw_score >= 70 THEN 'hot' WHEN b.raw_score >= 40 THEN 'warm' ELSE 'cold' END,
             CASE WHEN b.raw_score IS NULL THEN NULL ELSE 'Budget und Indikation passen, Erwartung realistisch.' END,
             CASE WHEN b.raw_score IS NULL THEN NULL ELSE jsonb_build_object('budgetMentioned', true, 'quiz', jsonb_build_object('a','1','b','2')) END,
             b.st,
             CASE WHEN b.r_t1 < 0.5 THEN ctx.actors[1 + (b.i % array_length(ctx.actors,1))] END,
             CASE WHEN b.st = 'gewonnen' THEN round((1500 + b.r_rev * 10500)::numeric, 2) END,
             b.created + interval '2 hours',
             b.created,
             CASE WHEN b.st <> 'neu' THEN b.created + (b.r_t1 * interval '2 days') END,
             CASE WHEN b.st <> 'neu' OR b.r_t1 < 0.3 THEN b.created + (b.r_t1 * interval '2 days') END,
             CASE WHEN b.st = 'gewonnen' THEN b.created + interval '10 days' END,
             jsonb_build_object('form', 'zielseite', 'fields', jsonb_build_object('name', 'x', 'consent', true, 'note', repeat('x', 300)))
      FROM b CROSS JOIN ctx`;
  }

  // Activities: status changes, calls, notes.
  const actor = userIds[0];
  await sql`
    INSERT INTO request_activities (request_id, actor_id, kind, body, meta, created_at)
    SELECT r.id, ${actor}, 'status_change', NULL,
           jsonb_build_object('from', 'neu', 'to', CASE WHEN r.status IN ('kontaktiert','nicht_erreicht','termin_vereinbart','spam') THEN r.status ELSE 'kontaktiert' END),
           r.created_at + interval '30 minutes' + (random() * interval '1 day')
    FROM requests r WHERE r.clinic_id = ${clinicId} AND r.status <> 'neu'`;
  await sql`
    INSERT INTO request_activities (request_id, actor_id, kind, body, meta, created_at)
    SELECT r.id, ${actor}, 'status_change', NULL,
           jsonb_build_object('from', 'kontaktiert', 'to', r.status),
           r.created_at + interval '2 days' + (random() * interval '5 days')
    FROM requests r WHERE r.clinic_id = ${clinicId}
      AND r.status IN ('beratung_erschienen','no_show','behandelt','gewonnen','verloren')`;
  await sql`
    INSERT INTO request_activities (request_id, actor_id, kind, body, meta, created_at)
    SELECT r.id, ${actor}, 'call', 'Anruf ' || k, jsonb_build_object('outcome', CASE WHEN random() < 0.4 THEN 'nicht_erreicht' ELSE 'erreicht' END),
           r.created_at + (k * interval '1 day') + (random() * interval '8 hours')
    FROM requests r CROSS JOIN generate_series(1, 3) k
    WHERE r.clinic_id = ${clinicId} AND r.status <> 'neu' AND random() < 0.45`;
  await sql`
    INSERT INTO request_activities (request_id, actor_id, kind, body, created_at)
    SELECT r.id, ${actor}, 'note', 'Notiz zur Anfrage. ' || repeat('Rueckruf vereinbart. ', 2),
           r.created_at + interval '1 day' + (random() * interval '6 days')
    FROM requests r WHERE r.clinic_id = ${clinicId} AND r.status <> 'neu' AND random() < 0.3`;

  // Wiedervorlagen: pending (some overdue) on open ones, done history on others.
  await sql`
    INSERT INTO request_followups (clinic_id, request_id, due_at, note, status, created_by, created_at)
    SELECT ${clinicId}, r.id, now() + ((random() * 15 - 5) * interval '1 day'), 'Rueckruf', 'pending', ${actor}, r.created_at + interval '1 day'
    FROM requests r WHERE r.clinic_id = ${clinicId}
      AND ((r.status IN ('kontaktiert','nicht_erreicht','termin_vereinbart') AND random() < 0.5) OR (r.status = 'neu' AND random() < 0.1))`;
  await sql`
    INSERT INTO request_followups (clinic_id, request_id, due_at, note, status, created_by, completed_by, completed_at, created_at)
    SELECT ${clinicId}, r.id, r.created_at + interval '3 days', 'Rueckruf', 'done', ${actor}, ${actor}, r.created_at + interval '3 days', r.created_at + interval '1 day'
    FROM requests r WHERE r.clinic_id = ${clinicId}
      AND r.status NOT IN ('neu','spam') AND random() < 0.15`;

  // Patient aggregates (what the PVS/portal keeps denormalized).
  await sql`
    UPDATE patients p SET request_count = s.c, won_count = s.w, lifetime_revenue_eur = s.rev
    FROM (SELECT patient_id, count(*) c, count(*) FILTER (WHERE status='gewonnen') w,
                 coalesce(sum(converted_revenue_eur),0) rev
          FROM requests WHERE clinic_id = ${clinicId} AND patient_id IS NOT NULL GROUP BY patient_id) s
    WHERE p.id = s.patient_id AND p.clinic_id = ${clinicId}`;

  // Ads spend, kpi rows, guarantee clock.
  const spendDays = big ? 730 : 120;
  await sql`
    INSERT INTO campaign_snapshots (clinic_id, snapshot_date, platform, spend_eur, impressions, clicks, leads, cpl_eur, ctr)
    SELECT ${clinicId}, (current_date - d)::date, pf, round((20 + random() * 80)::numeric, 2),
           (1000 + random() * 9000)::bigint, (20 + random() * 200)::bigint, floor(random() * 6)::int,
           round((10 + random() * 30)::numeric, 2), 0.0123
    FROM generate_series(0, ${spendDays - 1}) d CROSS JOIN (VALUES ('meta'), ('google')) v(pf)`;
  await sql`
    INSERT INTO kpi_daily (clinic_id, date, leads, appointments, consultations_held, cases_won, total_spend_eur, revenue_attributed_eur)
    SELECT ${clinicId}, (current_date - d)::date, floor(random()*40)::int, floor(random()*10)::int, floor(random()*8)::int,
           floor(random()*3)::int, round((40 + random()*150)::numeric, 2), round((random()*9000)::numeric, 2)
    FROM generate_series(0, ${spendDays - 1}) d`;
  // Onboarding gate passed (Fragebogen submitted + Blocker A1-A5 delivered), else every page redirects.
  await sql`INSERT INTO discovery_fragebogen (clinic_id, status, submitted_at, submitted_by) VALUES (${clinicId}, 'eingereicht', now(), ${userIds[0]})`;
  await sql`INSERT INTO checklist_items (clinic_id, item_id, status, delivered_at) SELECT ${clinicId}, x, 'geliefert', now() FROM unnest(ARRAY['A1','A2','A3','A4','A5']) x`;
  await sql`INSERT INTO guarantee_clocks (clinic_id, signed_on) VALUES (${clinicId}, current_date - ${big ? 700 : 100}::int)`;
  await sql`
    INSERT INTO notifications (user_id, clinic_id, kind, title, body, link, read_at, created_at)
    SELECT ${userIds[0]}, ${clinicId}, 'info', 'Testmeldung ' || g, 'Text', '/anfragen', CASE WHEN g % 3 = 0 THEN NULL ELSE now() END, now() - (g * interval '1 day')
    FROM generate_series(1, ${big ? 200 : 5}) g`;
}

async function doSeed() {
  const [{ c }] = await sql`SELECT count(*)::int c FROM clinics WHERE slug LIKE ${PREFIX + "%"}`;
  if (c > 0) {
    console.error(`Refusing: ${c} lasttest- clinics already exist. Run clean first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  await seedClinic({ slug: "lasttest-gross", name: "lasttest-gross", n: 20000, big: true });
  console.log(`lasttest-gross done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  for (let i = 1; i <= 49; i++) {
    const id = String(i).padStart(2, "0");
    const n = 50 + Math.floor(Math.random() * 451);
    await seedClinic({ slug: `lasttest-${id}`, name: `lasttest-${id}`, n, big: false });
  }
  await sql`ANALYZE`;
  console.log(`seed done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function doClean() {
  const ids = (await sql`SELECT id FROM clinics WHERE slug LIKE ${PREFIX + "%"} AND display_name LIKE ${PREFIX + "%"}`).map((r) => r.id);
  if (!ids.length) {
    console.log("nothing to clean");
    return;
  }
  const idArr = sql.array(ids);
  // Child tables first: request-keyed, then every table with clinic_id, repeated until no FK blocks.
  await sql`DELETE FROM request_activities WHERE request_id IN (SELECT id FROM requests WHERE clinic_id = ANY(${idArr}::uuid[]))`;
  const tables = (
    await sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'clinic_id'
        AND table_name NOT IN ('clinics', 'clinic_users')
        AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`
  ).map((r) => r.table_name);
  let pending = [...tables, "clinic_users"];
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next = [];
    for (const t of pending) {
      try {
        await sql.unsafe(`DELETE FROM "${t}" WHERE clinic_id = ANY($1::uuid[])`, [ids]);
      } catch (e) {
        next.push(t);
      }
    }
    pending = next;
  }
  if (pending.length) console.error("could not clear:", pending.join(", "));
  await sql`DELETE FROM clinics WHERE id = ANY(${idArr}::uuid[])`;
  console.log(`cleaned ${ids.length} clinics`);
}

try {
  if (mode === "seed") await doSeed();
  else await doClean();
} finally {
  await sql.end();
}
