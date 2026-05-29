/**
 * Seed script — inserts a demo clinic "Praxis Dr. Demo" with ~80 realistic
 * Anfragen weighted into the current month, 60 days of campaign snapshots
 * and KPI rollups, goals, three clinic users (inhaber / marketing / frontdesk),
 * connected ad-platform credentials and a populated progress timeline.
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

/**
 * Pick a `daysBack` so the resulting date falls in a chosen month bucket.
 * Bucket 0 = current month, 1 = prior month, 2 = two months ago.
 * Keeps dashboard "current month" cards densely populated while still
 * providing prior-period rows for delta comparisons.
 */
function daysBackInBucket(today: Date, bucket: 0 | 1 | 2): number {
  const dayOfMonth = today.getDate();
  if (bucket === 0) {
    // Anywhere from the 1st of this month through today.
    return randomInt(0, dayOfMonth - 1);
  }
  if (bucket === 1) {
    const priorMonthLast = new Date(today.getFullYear(), today.getMonth(), 0);
    const priorMonthDays = priorMonthLast.getDate();
    return randomInt(dayOfMonth, dayOfMonth + priorMonthDays - 1);
  }
  // bucket === 2
  const twoMonthsAgoLast = new Date(today.getFullYear(), today.getMonth() - 1, 0);
  const priorMonthLast = new Date(today.getFullYear(), today.getMonth(), 0);
  const minBack = dayOfMonth + priorMonthLast.getDate();
  return randomInt(minBack, minBack + twoMonthsAgoLast.getDate() - 1);
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
}> = [
  { name: "Filler",             slug: "filler",            keywords: "filler,hyaluron,lippen,jawline,wangen" },
  { name: "Botox",              slug: "botox",             keywords: "botox,falten,zornesfalte,stirnfalten" },
  { name: "Laser",              slug: "laser",             keywords: "laser,haarentfernung,couperose" },
  { name: "Microneedling",      slug: "microneedling",     keywords: "microneedling,needling,skinpen" },
  { name: "Profhilo",           slug: "profhilo",          keywords: "profhilo,bioremodeling" },
  { name: "Skinbooster",        slug: "skinbooster",       keywords: "skinbooster,booster,hydratation" },
  { name: "Peeling",            slug: "peeling",           keywords: "peeling,chemisch,fruchtsäure" },
  { name: "Fadenlifting",       slug: "fadenlifting",      keywords: "fadenlifting,faden,lift" },
  { name: "Kryolipolyse",       slug: "kryolipolyse",      keywords: "kryolipolyse,fettabbau,cool,coolsculpting" },
  { name: "Beratung",           slug: "beratung",          keywords: "beratung,consulting,gespräch" },
  { name: "Sonstige",           slug: "sonstige",          keywords: "" },
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

    // --- realistic requests, weighted into current month so dashboard cards fill ---
    // Distribution (today = anchor):
    //   60% in current month (dashboard "diesen Monat" cards)
    //   30% in prior month  (delta-vs-prior comparisons)
    //   10% two months back (longer trend lines, cohorts)
    const statuses = [
      "neu","neu","neu","neu","neu",
      "termin_vereinbart","termin_vereinbart",
      "beratung_erschienen",
      "gewonnen","gewonnen","gewonnen",
      "verloren",
    ] as const;

    const REQUEST_COUNT = 80;
    const today = new Date();

    let newCount = 0;
    /** Track patient rows per email so repeat customers aggregate. */
    const patientIdByEmail: Record<string, string> = {};
    /** Track simulated revenue + counts so the patients table reflects multi-touch LTV. */
    const patientStats: Record<
      string,
      { name: string; phone: string; firstSeen: Date; lastSeen: Date; revenue: number; reqCount: number; wonCount: number; firstSource: string }
    > = {};
    for (let i = 0; i < REQUEST_COUNT; i++) {
      const r = Math.random();
      const bucket: 0 | 1 | 2 = r < 0.6 ? 0 : r < 0.9 ? 1 : 2;
      const daysBack = daysBackInBucket(today, bucket);
      const createdAt = daysAgo(daysBack, randomInt(0, 8));
      // First three in the loop stay "neu" so the dashboard always shows fresh ones.
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

    // --- review_email_schedule — Bewertungsanfrage-Email-Versand-Plan.
    // Seed a handful of pending rows so /stimme analytics + the worker
    // dry-run have something to chew on.
    const nearTermPatients = Object.values(patientIdByEmail).slice(0, 4);
    for (let i = 0; i < nearTermPatients.length; i++) {
      const due = new Date();
      due.setDate(due.getDate() + 7 + i * 5);
      await sql`
        INSERT INTO review_email_schedule (
          clinic_id, patient_id, scheduled_for, kind, status, note, created_by
        ) VALUES (
          ${clinicId}, ${nearTermPatients[i]}, ${due.toISOString().slice(0, 10)},
          'review_request',
          'pending',
          'Bewertung erbitten',
          ${marketingId}
        )
      `;
    }

    // --- reviews (2 platforms × current + 6 months ago for trend) ---
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
      await sql`
        INSERT INTO reviews (clinic_id, platform, rating, total_count, period_start, period_end, recorded_at, notes)
        VALUES
          (${clinicId}, 'google', ${baseGoogle.toFixed(1)}, ${120 - months * 8}, ${periodStartStr}, ${periodEndStr}, ${periodEnd.toISOString()}, 'Manuell von Praxis erfasst'),
          (${clinicId}, 'jameda', ${baseJameda.toFixed(1)}, ${85  - months * 5}, ${periodStartStr}, ${periodEndStr}, ${periodEnd.toISOString()}, 'Manuell von Praxis erfasst')
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

    // --- campaign snapshots last 60 days (covers current + prior month for delta) ---
    for (let i = 0; i < 60; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;

      // Slightly lower activity on weekends to mimic real campaign rhythms.
      const metaSpend = (isWeekend ? randomInt(30, 55) : randomInt(55, 95)) + Math.random();
      const metaLeads = isWeekend ? randomInt(1, 3) : randomInt(2, 5);
      const googleSpend = (isWeekend ? randomInt(20, 40) : randomInt(40, 70)) + Math.random();
      const googleLeads = isWeekend ? randomInt(0, 2) : randomInt(1, 3);

      const metaImpressions = randomInt(2800, 6500);
      const metaClicks = randomInt(85, 240);
      const googleImpressions = randomInt(1200, 3800);
      const googleClicks = randomInt(45, 140);

      await sql`
        INSERT INTO campaign_snapshots (clinic_id, snapshot_date, platform, spend_eur, impressions, clicks, leads, cpl_eur, ctr)
        VALUES
          (${clinicId}, ${dateStr}, 'meta',   ${metaSpend.toFixed(2)},   ${metaImpressions},   ${metaClicks},   ${metaLeads},   ${(metaSpend / Math.max(1, metaLeads)).toFixed(2)},   ${(metaClicks / metaImpressions).toFixed(4)}),
          (${clinicId}, ${dateStr}, 'google', ${googleSpend.toFixed(2)}, ${googleImpressions}, ${googleClicks}, ${googleLeads}, ${(googleSpend / Math.max(1, googleLeads)).toFixed(2)}, ${(googleClicks / googleImpressions).toFixed(4)})
        ON CONFLICT (clinic_id, snapshot_date, platform) DO NOTHING
      `;
    }

    // --- kpi_daily rollup (coarse — worker recomputes nightly) ---
    // 60 days so the dashboard's "Tagesverlauf · 14 Tage" sparklines and the
    // prior-period delta chips both have rows to aggregate.
    for (let i = 0; i < 60; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;

      // Funnel: leads → appointments → consultations held → cases won.
      // Calibrated so the Trichter card on the dashboard shows realistic ratios
      // (~70% appointment rate, ~70% consultation rate, ~50% close rate).
      const leads = isWeekend ? randomInt(2, 4) : randomInt(3, 7);
      const appointments = Math.max(1, Math.round(leads * (0.55 + Math.random() * 0.25)));
      const consultations = Math.max(1, Math.round(appointments * (0.55 + Math.random() * 0.25)));
      const casesWon = Math.max(0, Math.round(consultations * (0.35 + Math.random() * 0.30)));

      const spend = randomInt(110, 195);
      const avgCaseValue = randomInt(900, 2400);
      const revenue = casesWon * avgCaseValue;
      const noShows = appointments > 0 ? Math.random() * 0.15 : 0;

      await sql`
        INSERT INTO kpi_daily (
          clinic_id, date,
          leads, cost_per_lead,
          appointments, consultations_held, cases_won,
          total_spend_eur, revenue_attributed_eur, roas, no_show_rate
        )
        VALUES (
          ${clinicId}, ${dateStr},
          ${leads},
          ${(spend / leads).toFixed(2)},
          ${appointments},
          ${consultations},
          ${casesWon},
          ${spend.toFixed(2)},
          ${revenue.toFixed(2)},
          ${spend > 0 ? (revenue / spend).toFixed(2) : "0"},
          ${noShows.toFixed(4)}
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
        (${clinicId}, 'leads', 30, ${monthStart}, ${monthEnd}, ${inhaberId}),
        (${clinicId}, 'revenue', 25000, ${monthStart}, ${monthEnd}, ${inhaberId}),
        (${clinicId}, 'total_requests', 50, ${monthStart}, ${monthEnd}, ${inhaberId})
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
        (${clinicId}, 'vertrag',              'Hauptvertrag EINS',                                    'clinics/praxis-dr-demo/vertrag-2026.pdf',                ARRAY['inhaber']::text[]),
        (${clinicId}, 'avv',                  'Auftragsverarbeitungsvertrag',                         'clinics/praxis-dr-demo/avv-2026.pdf',                    ARRAY['inhaber']::text[]),
        (${clinicId}, 'vertriebsleitfaden',   'Vertriebsleitfaden Version 2.1',                       'global/vertriebsleitfaden-v2-1.pdf',                     ARRAY['inhaber','marketing','frontdesk']::text[]),
        (${clinicId}, 'auswertung_monatlich', ${'Monats-Auswertung ' + (now.getMonth() > 0 ? `${String(now.getMonth()).padStart(2,'0')}/${now.getFullYear()}` : `12/${now.getFullYear() - 1}`)},
                                                                                                      'clinics/praxis-dr-demo/monatsbericht-letzter.pdf',       ARRAY['inhaber','marketing']::text[])
    `;

    // --- notifications ---
    await sql`
      INSERT INTO notifications (user_id, clinic_id, kind, title, body, link)
      VALUES
        (${inhaberId},   ${clinicId}, 'new_lead',    'Neue heiße Anfrage',     'Dr. Müller-Krug hat soeben eine Terminanfrage gestellt (KI-Bewertung 87).', '/anfragen'),
        (${marketingId}, ${clinicId}, 'sla_warning', 'Antwort-Frist in 60 Minuten', 'Eine Anfrage erreicht bald die Antwort-Frist. Bitte kontaktieren.',     '/anfragen'),
        (${inhaberId},   ${clinicId}, 'asset_ready', 'Neue Medien verfügbar',  'Das Video vom Shooting am 14.04. ist bereit zum Download.',             '/medien')
    `;

    // --- platform_credentials (Werbe-Sync card on dashboard + Werbebudget page) ---
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

    // --- clinic_timeline_entries (Fortschritt page) ---
    // Praxisinhaber:innen sind keine Marketing-Profis — Titel und Beschreibungen
    // werden bewusst in einfachem Deutsch ohne Anglizismen geschrieben.
    const reportEventDate = new Date();
    reportEventDate.setDate(reportEventDate.getDate() + 6);
    const reportMonthLabel = new Intl.DateTimeFormat("de-DE", {
      month: "long",
      year: "numeric",
    }).format(reportEventDate);
    await sql`
      INSERT INTO clinic_timeline_entries (
        clinic_id, title, description, event_date, status, created_by_email
      ) VALUES
        (${clinicId}, 'Auftakt-Gespräch',
         'Erstes Treffen mit Ihrem Team. Wir klären Ihre Ziele, Ihre Wunsch-Patientinnen und die Bildsprache Ihrer Praxis.',
         now() - interval '52 days', 'abgeschlossen', 'team@eins-visuals.de'),
        (${clinicId}, 'Erste Werbeanzeigen gestartet',
         'Anzeigen bei Instagram, Facebook und Google laufen parallel. Schwerpunkt: Hyaluron-Behandlungen.',
         now() - interval '38 days', 'abgeschlossen', 'team@eins-visuals.de'),
        (${clinicId}, 'Foto- und Videoaufnahmen in München',
         'Aufnahmen bei Ihnen vor Ort für die Werbeanzeigen im Frühjahr.',
         now() - interval '21 days', 'abgeschlossen', 'team@eins-visuals.de'),
        (${clinicId}, 'Zwei Anzeigen-Varianten verglichen',
         'Die einfühlsamere Variante wird 37 % häufiger angeklickt. Sie wird ab dieser Woche unsere Haupt-Anzeige.',
         now() - interval '6 days', 'abgeschlossen', 'team@eins-visuals.de'),
        (${clinicId}, 'Empfehlung: Automatische Erinnerungen aktivieren',
         'Wir empfehlen, Ihre Patientinnen alle vier Monate automatisch zu erinnern. Direkt aus dem Portal.',
         now() - interval '1 day', 'laeuft', 'team@eins-visuals.de'),
        (${clinicId}, ${`Monatsbericht ${reportMonthLabel}`},
         'Ihr Monatsbericht mit allen wichtigen Zahlen, einer Auswertung der Anfragen und unseren Empfehlungen für den nächsten Monat.',
         now() + interval '6 days', 'geplant', 'team@eins-visuals.de'),
        (${clinicId}, 'Großes Quartals-Gespräch',
         'Wir blicken auf die letzten drei Monate zurück, verteilen das Werbebudget neu und entwickeln neue Anzeigen-Ideen für die kommenden Monate.',
         now() + interval '23 days', 'geplant', 'team@eins-visuals.de')
    `;

    console.log(`✓ seeded clinic ${clinicId} (Praxis Dr. Demo)`);
    console.log(`  inhaber:    inhaber@praxis-demo.de`);
    console.log(`  marketing:  marketing@praxis-demo.de`);
    console.log(`  frontdesk:  frontdesk@praxis-demo.de`);
    console.log(`  Anfragen:   ${REQUEST_COUNT} (${newCount} neu, schwerpunktmäßig im laufenden Monat)`);
    console.log(`  KPI-Tage:   60`);
    console.log(`  Werbekonten: meta + google verbunden (Demo-Token)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
