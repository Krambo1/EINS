/**
 * Seed script — inserts a demo clinic "Praxis Dr. Demo" with ~30 realistic
 * Anfragen, ~7 days of campaign snapshots, goals, and three users
 * (inhaber / marketing / frontdesk).
 *
 * The admin user (Karam) comes from ADMIN_EMAILS env and is created
 * on-demand by the admin login flow.
 *
 * Runs on the SUPERUSER connection; bypasses RLS.
 */

import "../lib/load-env";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

type ClientSql = ReturnType<typeof postgres>;

// ----- Helpers -----
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function daysAgo(days: number, hourOffset = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(9 + hourOffset, randomInt(0, 59), 0, 0);
  return d;
}

// ----- Fixture content -----
const FIRST_NAMES = [
  "Anna","Bernd","Christine","David","Elena","Florian","Gisela","Hans",
  "Inga","Johannes","Katrin","Lars","Maria","Niklas","Olivia","Paul",
  "Regine","Stefan","Tobias","Ulrike","Vera","Werner","Xenia","Yannick",
  "Zita","Klaus","Nina","Markus","Beatrice","Roland",
];
const LAST_NAMES = [
  "Meyer","Schmidt","Müller","Fischer","Weber","Becker","Hoffmann","Schulz",
  "Koch","Bauer","Richter","Wolf","Neumann","Krüger","Zimmermann","Hofmann",
  "Schmitt","Braun","Krause","Hartmann","Werner","Schmid","Lange","Klein",
  "Wagner","Lehmann","Graf","Kraus","Keller","Herrmann",
];
const TREATMENTS = [
  "Hyaluron Lippen","Faltenbehandlung mit Botox","Kryolipolyse Bauch",
  "Laser-Haarentfernung","Zahnkorrektur (Aligner)","Bleaching",
  "Intimchirurgie Beratung","Nasenkorrektur ohne OP","Oberlid-Straffung",
  "Microneedling","Chemisches Peeling","Brustvergrößerung Beratung",
  "Augenbrauen-Lifting","Fadenlifting","PRP Haarwuchs",
];

/** Treatment-category seed: matches the keyword classifier in the request intake. */
const TREATMENT_CATEGORIES: Array<{
  name: string;
  slug: string;
  keywords: string;
  defaultRecallMonths: number | null;
}> = [
  { name: "Filler",             slug: "filler",            keywords: "filler,hyaluron,lippen,jawline,wangen", defaultRecallMonths: 9 },
  { name: "Botox",              slug: "botox",             keywords: "botox,falten,zornesfalte,stirnfalten",   defaultRecallMonths: 4 },
  { name: "Laser",              slug: "laser",             keywords: "laser,haarentfernung,couperose",          defaultRecallMonths: 6 },
  { name: "Microneedling",      slug: "microneedling",     keywords: "microneedling,needling,skinpen",          defaultRecallMonths: 3 },
  { name: "Profhilo",           slug: "profhilo",          keywords: "profhilo,bioremodeling",                  defaultRecallMonths: 6 },
  { name: "Skinbooster",        slug: "skinbooster",       keywords: "skinbooster,booster,hydratation",         defaultRecallMonths: 6 },
  { name: "Peeling",            slug: "peeling",           keywords: "peeling,chemisch,fruchtsäure",            defaultRecallMonths: 4 },
  { name: "Fadenlifting",       slug: "fadenlifting",      keywords: "fadenlifting,faden,lift",                 defaultRecallMonths: 12 },
  { name: "Kryolipolyse",       slug: "kryolipolyse",      keywords: "kryolipolyse,fettabbau,cool,coolsculpting", defaultRecallMonths: 6 },
  { name: "Beratung",           slug: "beratung",          keywords: "beratung,consulting,gespräch",            defaultRecallMonths: null },
  { name: "Sonstige",           slug: "sonstige",          keywords: "",                                        defaultRecallMonths: null },
];
const MESSAGES = [
  "Ich hätte gern ein kurzes Vorgespräch per Telefon. Wann ist das möglich?",
  "Wie schnell geht das und was kostet es ungefähr? Ich würde mich freuen über eine Info.",
  "Meine Schwester hat bei Ihnen Botox machen lassen, das sah super aus. Ich hätte auch Interesse.",
  "Kann ich das auch in Raten bezahlen? Bitte um eine kurze Antwort.",
  "Ich bin 58 und überlege schon lange. Bitte rufen Sie mich an.",
  "Gibt es auch Termine am Wochenende? Unter der Woche ist es schwierig.",
  "Ich möchte unverbindlich Infos. Vielen Dank im Voraus.",
  "HILFE — war bei einer anderen Praxis und bin unzufrieden. Können Sie das korrigieren?",
];
const SOURCES = ["meta", "google", "formular", "manuell"] as const;

async function main() {
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

    const clinicId = randomUUID();
    await sql`
      INSERT INTO clinics (id, legal_name, display_name, slug, plan, plan_started_at, default_doctor_email, hwg_contact_name, hwg_contact_email)
      VALUES (
        ${clinicId},
        'Praxis Dr. Demo GmbH',
        'Praxis Dr. Demo',
        'praxis-dr-demo',
        'erweitert',
        now() - interval '120 days',
        'dr.demo@example.com',
        'Dr. Martin Demo',
        'hwg@example.com'
      )
    `;

    // --- users ---
    const inhaberId = randomUUID();
    const marketingId = randomUUID();
    const frontdeskId = randomUUID();
    await sql`
      INSERT INTO clinic_users (id, clinic_id, email, full_name, role, mfa_enrolled, last_login_at)
      VALUES
        (${inhaberId},   ${clinicId}, 'inhaber@praxis-demo.de',   'Dr. Martin Demo', 'inhaber',  true,  now() - interval '2 hours'),
        (${marketingId}, ${clinicId}, 'marketing@praxis-demo.de', 'Lisa Werbung',     'marketing', false, now() - interval '1 day'),
        (${frontdeskId}, ${clinicId}, 'frontdesk@praxis-demo.de', 'Sabine Empfang',   'frontdesk', false, now() - interval '3 hours')
    `;

    // --- treatments (per-clinic categories) ---
    const treatmentIdBySlug: Record<string, string> = {};
    for (let i = 0; i < TREATMENT_CATEGORIES.length; i++) {
      const cat = TREATMENT_CATEGORIES[i]!;
      const id = randomUUID();
      treatmentIdBySlug[cat.slug] = id;
      await sql`
        INSERT INTO treatments (id, clinic_id, name, slug, display_order, default_recall_months, keywords)
        VALUES (${id}, ${clinicId}, ${cat.name}, ${cat.slug}, ${i}, ${cat.defaultRecallMonths}, ${cat.keywords})
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

    // Helper: classify a treatment_wish text against the seeded keyword map.
    function categorize(wish: string): string | null {
      const text = wish.toLowerCase();
      for (const cat of TREATMENT_CATEGORIES) {
        if (!cat.keywords) continue;
        for (const kw of cat.keywords.split(",")) {
          if (kw && text.includes(kw)) return treatmentIdBySlug[cat.slug] ?? null;
        }
      }
      return treatmentIdBySlug["sonstige"] ?? null;
    }

    // --- 30 realistic requests across last 30 days ---
    const statuses = [
      "neu","neu","neu",
      "qualifiziert","qualifiziert",
      "termin_vereinbart","termin_vereinbart",
      "beratung_erschienen",
      "gewonnen","gewonnen",
      "verloren",
    ] as const;

    let newCount = 0;
    /** Track patient rows per email so repeat customers aggregate. */
    const patientIdByEmail: Record<string, string> = {};
    /** Track simulated revenue + counts so the patients table reflects multi-touch LTV. */
    const patientStats: Record<
      string,
      { name: string; phone: string; firstSeen: Date; lastSeen: Date; revenue: number; reqCount: number; wonCount: number; firstSource: string }
    > = {};
    /** Map request_id → won_at so we can build recalls below. */
    const wonRequests: Array<{ requestId: string; patientId: string; treatmentId: string | null; wonAt: Date }> = [];

    for (let i = 0; i < 30; i++) {
      const daysBack = randomInt(0, 29);
      const createdAt = daysAgo(daysBack, randomInt(0, 8));
      const status = i < 3 ? "neu" : pick(statuses);
      const source = pick(SOURCES);
      // 25% chance to repeat a previously-seen contact so LTV accumulates.
      const repeatPool = Object.values(patientStats);
      const repeat = repeatPool.length > 0 && Math.random() < 0.25;
      const firstName = repeat ? repeatPool[0]!.name.split(" ")[0]! : pick(FIRST_NAMES);
      const lastName  = repeat ? repeatPool[0]!.name.split(" ")[1] ?? pick(LAST_NAMES) : pick(LAST_NAMES);
      const phone = repeat
        ? repeatPool[0]!.phone
        : `+49 ${randomInt(150, 179)} ${randomInt(1000000, 9999999)}`;
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;
      const aiScore = randomInt(25, 95);
      const aiCategory = aiScore >= 70 ? "hot" : aiScore >= 40 ? "warm" : "cold";
      const message = pick(MESSAGES);
      const treatment = pick(TREATMENTS);
      const treatmentId = categorize(treatment);
      // 60% chance to come in for the secondary location (so multi-location UI shows split data).
      const locationId = Math.random() < 0.4 ? secondaryLocationId : primaryLocationId;
      if (status === "neu") newCount += 1;

      // Upsert patient row (inserted into DB now so the FK on requests resolves).
      let patientId: string;
      if (patientIdByEmail[email]) {
        patientId = patientIdByEmail[email]!;
        const stats = patientStats[email]!;
        stats.lastSeen = createdAt > stats.lastSeen ? createdAt : stats.lastSeen;
        stats.reqCount += 1;
        if (status === "gewonnen") {
          const revenue = randomInt(400, 4500);
          stats.revenue += revenue;
          stats.wonCount += 1;
        }
      } else {
        patientId = randomUUID();
        patientIdByEmail[email] = patientId;
        const revenue = status === "gewonnen" ? randomInt(400, 4500) : 0;
        patientStats[email] = {
          name: `${firstName} ${lastName}`,
          phone,
          firstSeen: createdAt,
          lastSeen: createdAt,
          revenue,
          reqCount: 1,
          wonCount: status === "gewonnen" ? 1 : 0,
          firstSource: source,
        };
        // Initial INSERT — final stats are written via UPDATE after the loop.
        await sql`
          INSERT INTO patients (
            id, clinic_id, email, phone, full_name,
            first_seen_at, last_seen_at, first_touch_source,
            lifetime_revenue_eur, request_count, won_count
          ) VALUES (
            ${patientId},
            ${clinicId},
            ${email},
            ${phone},
            ${`${firstName} ${lastName}`},
            ${createdAt.toISOString()},
            ${createdAt.toISOString()},
            ${source},
            0,
            0,
            0
          )
        `;
      }

      const convertedRevenue = status === "gewonnen" ? String(randomInt(400, 4500)) : null;

      const slaAdd =
        status === "neu"
          ? `+ interval '3 hours'`
          : `+ interval '24 hours'`;

      const aiSignals = {
        budgetMentioned: /€|budget|euro|preis/i.test(message),
        treatmentSpecified: treatmentId !== treatmentIdBySlug["sonstige"],
        contactComplete: !!(email && phone),
        hasUrgency: /schnell|sofort|dringend/i.test(message),
        messageLength: message.length,
      };

      const requestId = randomUUID();
      await sql`
        INSERT INTO requests (
          id, clinic_id, source, contact_name, contact_email, contact_phone,
          treatment_wish, treatment_id, patient_id, location_id,
          message,
          ai_score, ai_category, ai_reasoning, ai_signals, ai_prompt_version,
          status, assigned_to,
          converted_revenue_eur,
          sla_respond_by,
          created_at, dsgvo_consent_at,
          first_contacted_at, won_at,
          utm, raw_payload
        ) VALUES (
          ${requestId},
          ${clinicId},
          ${source},
          ${`${firstName} ${lastName}`},
          ${email},
          ${phone},
          ${treatment},
          ${treatmentId},
          ${patientId},
          ${locationId},
          ${message},
          ${aiScore},
          ${aiCategory},
          ${`Score ${aiScore} (${aiCategory}) — basierend auf Nachrichtenlänge, Terminbereitschaft, Budget-Indikation.`},
          ${sql.json(aiSignals)},
          'v1',
          ${status},
          ${status === "neu" ? null : pick([inhaberId, marketingId, frontdeskId])},
          ${convertedRevenue},
          ${createdAt.toISOString()}::timestamptz ${sql.unsafe(slaAdd)},
          ${createdAt.toISOString()},
          ${createdAt.toISOString()},
          ${status !== "neu" ? new Date(createdAt.getTime() + 90 * 60_000).toISOString() : null},
          ${status === "gewonnen" ? new Date(createdAt.getTime() + 7 * 24 * 60 * 60_000).toISOString() : null},
          ${sql.json({ utm_source: source, utm_campaign: `demo_${randomInt(1, 4)}` })},
          ${sql.json({ source })}
        )
      `;
      if (status === "gewonnen") {
        wonRequests.push({
          requestId,
          patientId,
          treatmentId,
          wonAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60_000),
        });
      }

      // Seed one activity — Status change or note
      if (status !== "neu") {
        await sql`
          INSERT INTO request_activities (request_id, actor_id, kind, body, created_at)
          VALUES (
            ${requestId},
            ${pick([inhaberId, marketingId, frontdeskId])},
            'note',
            ${`Erstkontakt erfolgreich. ${treatment} besprochen.`},
            ${new Date(createdAt.getTime() + 60 * 60_000).toISOString()}
          )
        `;
      }
    }

    // --- patients (after request loop so final aggregates are written via UPDATE) ---
    for (const [email, stats] of Object.entries(patientStats)) {
      const patientId = patientIdByEmail[email]!;
      await sql`
        UPDATE patients SET
          last_seen_at         = ${stats.lastSeen.toISOString()},
          lifetime_revenue_eur = ${stats.revenue.toFixed(2)},
          request_count        = ${stats.reqCount},
          won_count            = ${stats.wonCount}
        WHERE id = ${patientId}
      `;
    }

    // --- request_recalls — one recall per won request, scheduled 4-9 months out ---
    for (const won of wonRequests) {
      const months = randomInt(4, 9);
      const scheduled = new Date(won.wonAt);
      scheduled.setMonth(scheduled.getMonth() + months);
      await sql`
        INSERT INTO request_recalls (
          clinic_id, request_id, patient_id, scheduled_for, kind, status, note, created_by
        ) VALUES (
          ${clinicId}, ${won.requestId}, ${won.patientId},
          ${scheduled.toISOString().slice(0, 10)},
          'recall',
          ${scheduled.getTime() < Date.now() ? "completed" : "pending"},
          ${'Auffrischungs-Termin nach ' + months + ' Monaten'},
          ${marketingId}
        )
      `;
    }

    // A handful of recalls due in the next 30 days so the dashboard widget shows.
    const nearTermPatients = Object.values(patientIdByEmail).slice(0, 4);
    for (let i = 0; i < nearTermPatients.length; i++) {
      const due = new Date();
      due.setDate(due.getDate() + 7 + i * 5);
      await sql`
        INSERT INTO request_recalls (
          clinic_id, patient_id, scheduled_for, kind, status, note, created_by
        ) VALUES (
          ${clinicId}, ${nearTermPatients[i]}, ${due.toISOString().slice(0, 10)},
          ${pick(["followup", "review_request"])},
          'pending',
          'Bewertung erbitten',
          ${marketingId}
        )
      `;
    }

    // --- reviews (4 platforms × current + 6 months ago for trend) ---
    for (const months of [0, 3, 6]) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() - months);
      const periodEndStr = periodEnd.toISOString().slice(0, 10);
      const periodStart = new Date(periodEnd);
      periodStart.setMonth(periodStart.getMonth() - 1);
      const periodStartStr = periodStart.toISOString().slice(0, 10);
      // Slowly improve rating over time so trend points upward.
      const baseGoogle = 4.5 + (3 - months) * 0.05;
      const baseJameda = 4.6 + (3 - months) * 0.04;
      const baseTrust  = 4.3 + (3 - months) * 0.06;
      await sql`
        INSERT INTO reviews (clinic_id, platform, rating, total_count, period_start, period_end, recorded_at, notes)
        VALUES
          (${clinicId}, 'google',     ${baseGoogle.toFixed(1)}, ${120 - months * 8}, ${periodStartStr}, ${periodEndStr}, ${periodEnd.toISOString()}, 'Manuell von Praxis erfasst'),
          (${clinicId}, 'jameda',     ${baseJameda.toFixed(1)}, ${85  - months * 5}, ${periodStartStr}, ${periodEndStr}, ${periodEnd.toISOString()}, 'Manuell von Praxis erfasst'),
          (${clinicId}, 'trustpilot', ${baseTrust.toFixed(1)},  ${22  - months * 2}, ${periodStartStr}, ${periodEndStr}, ${periodEnd.toISOString()}, 'Manuell von Praxis erfasst')
      `;
    }

    // --- spend goal so the Werbebudget pace card has a target ---
    await sql`
      INSERT INTO goals (clinic_id, metric, target_value, period_start, period_end, created_by)
      VALUES (${clinicId}, 'spend', 4500,
        ${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)},
        ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10)},
        ${inhaberId})
    `;

    // --- campaign snapshots last 30 days ---
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);

      const metaSpend = randomInt(40, 80) + Math.random();
      const metaLeads = randomInt(0, 3);
      const googleSpend = randomInt(25, 55) + Math.random();
      const googleLeads = randomInt(0, 2);

      await sql`
        INSERT INTO campaign_snapshots (clinic_id, snapshot_date, platform, spend_eur, impressions, clicks, leads, cpl_eur, ctr)
        VALUES
          (${clinicId}, ${dateStr}, 'meta',   ${metaSpend.toFixed(2)}, ${randomInt(2000, 6000)}, ${randomInt(60, 220)}, ${metaLeads}, ${(metaSpend / Math.max(1, metaLeads)).toFixed(2)}, ${(Math.random() * 0.05).toFixed(4)}),
          (${clinicId}, ${dateStr}, 'google', ${googleSpend.toFixed(2)}, ${randomInt(1000, 3500)}, ${randomInt(30, 120)}, ${googleLeads}, ${(googleSpend / Math.max(1, googleLeads)).toFixed(2)}, ${(Math.random() * 0.07).toFixed(4)})
        ON CONFLICT (clinic_id, snapshot_date, platform) DO NOTHING
      `;
    }

    // --- kpi_daily rollup (coarse — worker recomputes nightly) ---
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      const leads = randomInt(0, 3);
      const spend = randomInt(80, 150);
      const revenue = randomInt(0, 4500);
      await sql`
        INSERT INTO kpi_daily (clinic_id, date, qualified_leads, cost_per_qualified_lead, appointments, consultations_held, cases_won, total_spend_eur, revenue_attributed_eur, roas)
        VALUES (
          ${clinicId}, ${dateStr},
          ${leads},
          ${leads > 0 ? (spend / leads).toFixed(2) : null},
          ${randomInt(0, leads)},
          ${randomInt(0, leads)},
          ${revenue > 0 ? 1 : 0},
          ${spend.toFixed(2)},
          ${revenue.toFixed(2)},
          ${spend > 0 ? (revenue / spend).toFixed(2) : "0"}
        )
        ON CONFLICT (clinic_id, date) DO NOTHING
      `;
    }

    // --- goals (1 active for current month) ---
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    await sql`
      INSERT INTO goals (clinic_id, metric, target_value, period_start, period_end, created_by)
      VALUES
        (${clinicId}, 'qualified_leads', 30, ${monthStart}, ${monthEnd}, ${inhaberId}),
        (${clinicId}, 'revenue', 25000, ${monthStart}, ${monthEnd}, ${inhaberId})
    `;

    // --- animation library (global) ---
    await sql`DELETE FROM animation_library WHERE title IN ('Botox Standard','Hyaluron Lippen','Laser Haarentfernung','Kryolipolyse Bauch')`;
    const animIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await sql`
      INSERT INTO animation_library (id, title, treatment_tag, description, storage_key_master, duration_s)
      VALUES
        (${animIds[0]!}, 'Botox Standard', 'botox',
           'Klassischer 15-Sekunden-Clip für Botox-Behandlungen. Vorher/Nachher-Aufbau.',
           'global/animations/botox-standard.mp4', 15),
        (${animIds[1]!}, 'Hyaluron Lippen', 'hyaluron',
           'Aufbauvideo für Hyaluron-Lippenbehandlung, 20s, inkl. Endresultat.',
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

    // --- documents (placeholder PDFs, storage_key points to local files) ---
    await sql`
      INSERT INTO documents (clinic_id, kind, title, storage_key, visible_to_roles)
      VALUES
        (${clinicId}, 'vertrag',              'Hauptvertrag EINS Visuals',                            'clinics/praxis-dr-demo/vertrag-2026.pdf',                ARRAY['inhaber']::text[]),
        (${clinicId}, 'avv',                  'Auftragsverarbeitungsvertrag',                         'clinics/praxis-dr-demo/avv-2026.pdf',                    ARRAY['inhaber']::text[]),
        (${clinicId}, 'vertriebsleitfaden',   'Vertriebsleitfaden Version 2.1',                       'global/vertriebsleitfaden-v2-1.pdf',                     ARRAY['inhaber','marketing','frontdesk']::text[]),
        (${clinicId}, 'auswertung_monatlich', ${'Monats-Auswertung ' + (now.getMonth() > 0 ? `${String(now.getMonth()).padStart(2,'0')}/${now.getFullYear()}` : `12/${now.getFullYear() - 1}`)},
                                                                                                      'clinics/praxis-dr-demo/monatsbericht-letzter.pdf',       ARRAY['inhaber','marketing']::text[])
    `;

    // --- notifications ---
    await sql`
      INSERT INTO notifications (user_id, clinic_id, kind, title, body, link)
      VALUES
        (${inhaberId},   ${clinicId}, 'new_lead',    'Neue heiße Anfrage',     'Dr. Müller-Krug hat soeben eine Terminanfrage gestellt (KI-Score 87).', '/anfragen'),
        (${marketingId}, ${clinicId}, 'sla_warning', 'SLA in 60 Minuten',      'Eine Anfrage läuft bald aus der SLA-Zeit. Bitte kontaktieren.',         '/anfragen'),
        (${inhaberId},   ${clinicId}, 'asset_ready', 'Neue Medien verfügbar',  'Das Video vom Shooting am 14.04. ist bereit zum Download.',             '/medien')
    `;

    console.log(`✓ seeded clinic ${clinicId} (Praxis Dr. Demo)`);
    console.log(`  inhaber:    inhaber@praxis-demo.de`);
    console.log(`  marketing:  marketing@praxis-demo.de`);
    console.log(`  frontdesk:  frontdesk@praxis-demo.de`);
    console.log(`  Anfragen:   30 (${newCount} neu)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
