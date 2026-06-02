/**
 * P3-2: synthetic-data seed for the staging Praxis soak.
 *
 * Spins up a 10,000-patient cohort plus 60 days of canonical PVS events
 * against a known clinic_id, including the linker adversarial set the
 * P1-1 hardening was tuned against. Used to populate
 * `staging.eins.ag` for the 30-day soak called for in the
 * hardening plan's Phase 3.
 *
 * What it does:
 *   1. Validates the target clinic exists and has a `pvs_link` row.
 *   2. Generates a patient pool with realistic German names, emails,
 *      phones, and DOBs.
 *   3. Layers the adversarial fixtures into the pool at known indices
 *      (see ADVERSARIAL_PAIRS) so the soak exercises the failure
 *      modes the linker was tightened against.
 *   4. Emits canonical events through `applyPvsEvent` directly
 *      (in-process; same code path /api/pvs/events takes).
 *   5. Writes a JSON manifest to `--out` so the operator's weekly
 *      soak-report query can diff observed vs. expected.
 *
 * Dry-run by default. Pass --apply to actually write to the DB. A
 * dry-run prints a summary and exits without enqueuing anything.
 *
 * Usage (PowerShell; see CLAUDE.md gotchas):
 *
 *   # Dry-run: show what the seed would do.
 *   pnpm --filter portal tsx scripts/pvs-seed-staging.ts `
 *     --clinic-id 41a4... `
 *     --patients 10000 --days 60
 *
 *   # Apply.
 *   pnpm --filter portal tsx scripts/pvs-seed-staging.ts `
 *     --clinic-id 41a4... `
 *     --patients 10000 --days 60 `
 *     --out C:\soak-2026-05-24-manifest.json `
 *     --apply
 *
 * Safety rails:
 *   - The script REFUSES to run when DATABASE_URL points at a host
 *     containing "prod" or matching the portal production hostname.
 *     The soak is for staging only; running against prod by accident
 *     would create thousands of fake patients in customer-visible
 *     dashboards.
 *   - The target clinic_id must contain the prefix "STAGING-" in its
 *     `clinic_users.email` row OR the clinic must have at most 50
 *     existing rows across patients + requests. This is belt-and-
 *     suspenders against pointing at a real clinic with prod data.
 *   - Adversarial fixtures are tagged with `seed_run_id` in the
 *     `bemerkung` field so they're greppable from the linking_failures
 *     inbox without confusing real-operator triage.
 *
 * Idempotency: re-running with the same `--seed <int>` produces the
 * same patient cohort and the same `pvsExternalEventId`s. The portal's
 * UNIQUE-on-conflict + dedupe path means a re-run is a no-op rather
 * than a duplicate burst.
 */

// MUST be first: neutralizes the `server-only` throw before any module that
// imports it (transitively via ../src/db/client → server modules) evaluates
// under plain tsx. See ../src/worker/shim-server-only.ts.
import "../src/worker/shim-server-only";

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../src/db/client";
import {
  applyPvsEvent,
  type PvsEvent,
} from "../src/server/pvs-events";

// ---------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  const v = args[i + 1];
  if (v.startsWith("--")) return undefined;
  return v;
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function requireFlag(args: string[], name: string): string {
  const v = flag(args, name);
  if (!v) {
    console.error(`error: missing required ${name}`);
    process.exit(2);
  }
  return v;
}

// ---------------------------------------------------------------
// Deterministic RNG so re-runs are reproducible.
// ---------------------------------------------------------------

/**
 * Mulberry32; small, fast, deterministic PRNG. Seeded from --seed
 * (default 1) so the same invocation produces the same patient cohort.
 * Cryptographically irrelevant (we are generating fake patient data,
 * not key material).
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function int(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

// ---------------------------------------------------------------
// German name + treatment zoos.
// ---------------------------------------------------------------

const FIRST_NAMES_F = [
  "Maria", "Anna", "Sophie", "Lisa", "Julia", "Sarah", "Lena", "Hannah",
  "Emma", "Mia", "Lara", "Marie", "Klara", "Greta", "Antonia",
] as const;
const FIRST_NAMES_M = [
  "Klaus", "Hans", "Thomas", "Michael", "Stefan", "Frank", "Andreas",
  "Peter", "Wolfgang", "Martin", "Lukas", "Felix", "Jonas", "Paul", "Max",
] as const;
const LAST_NAMES = [
  "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner",
  "Becker", "Schulz", "Hoffmann", "Schäfer", "Koch", "Bauer", "Richter",
  "Klein", "Wolf", "Schröder", "Neumann", "Schwarz", "Zimmermann",
  "Braun", "Krüger", "Hofmann", "Hartmann", "Lange", "Werner",
] as const;
const EMAIL_DOMAINS = [
  "gmail.com", "web.de", "gmx.de", "t-online.de", "yahoo.de", "outlook.de",
  "icloud.com", "freenet.de",
] as const;

const TREATMENTS = [
  { code: "BOTOX-STIRN", label: "Botox Stirn", priceMinCents: 25_000, priceMaxCents: 40_000 },
  { code: "BOTOX-GLAB", label: "Botox Glabella", priceMinCents: 20_000, priceMaxCents: 35_000 },
  { code: "HYAL-LIPP", label: "Hyaluron Lippen", priceMinCents: 30_000, priceMaxCents: 55_000 },
  { code: "HYAL-NASO", label: "Hyaluron Nasolabialfalten", priceMinCents: 40_000, priceMaxCents: 70_000 },
  { code: "FADENLIFT", label: "Fadenlifting Wange", priceMinCents: 80_000, priceMaxCents: 180_000 },
  { code: "PRP-HAAR", label: "PRP Haar", priceMinCents: 25_000, priceMaxCents: 60_000 },
  { code: "PEEL-MED", label: "Medizinisches Peeling", priceMinCents: 15_000, priceMaxCents: 35_000 },
  { code: "MESO", label: "Mesotherapie", priceMinCents: 18_000, priceMaxCents: 40_000 },
  { code: "LIPO-AESTH", label: "Aesthetische Lipolyse", priceMinCents: 100_000, priceMaxCents: 350_000 },
  { code: "LID-OBLID", label: "Oberlid-Korrektur", priceMinCents: 180_000, priceMaxCents: 300_000 },
] as const;

// ---------------------------------------------------------------
// Adversarial fixtures (P1-1 + Section 3 of pvs-redteam.md)
// ---------------------------------------------------------------

/**
 * Each pair below is a curated test case for the linker's tightened
 * auto-accept gate. After the soak, an operator should grep the
 * linking_failures inbox by `seed_marker` and verify the actual
 * resolution matches the expected column.
 */
interface AdversarialFixture {
  marker: string;
  description: string;
  /** Expected linker outcome for the *second* patient of the pair. */
  expected: "auto-merge" | "review-queue" | "new-patient";
  patients: Array<{
    pvsPatientId: string;
    fullName: string;
    email?: string;
    phone?: string;
    dob: string;
  }>;
}

const ADVERSARIAL_PAIRS: AdversarialFixture[] = [
  {
    marker: "ADV-1-namesake-dob",
    description:
      "Two 'Maria Müller' / 'Maria Müller-Schmidt' born the same day; different patients; must NOT auto-merge (no email match)",
    expected: "review-queue",
    patients: [
      {
        pvsPatientId: "ADV1-A",
        fullName: "Maria Müller",
        email: "maria.mueller@web.de",
        phone: "+491761000001",
        dob: "1985-03-12",
      },
      {
        pvsPatientId: "ADV1-B",
        fullName: "Maria Müller-Schmidt",
        // Distinct email; name-trigram + dob alone must NOT auto-merge.
        email: "maria.mueller-schmidt@gmx.de",
        phone: "+491761000002",
        dob: "1985-03-12",
      },
    ],
  },
  {
    marker: "ADV-2-phone-format",
    description:
      "Same person, phone written as +491761... vs 01761...; same email + dob; MUST auto-merge via email-exact",
    expected: "auto-merge",
    patients: [
      {
        pvsPatientId: "ADV2-A",
        fullName: "Anna Becker",
        email: "anna.becker.adv2@gmail.com",
        phone: "+4917612345678",
        dob: "1990-07-22",
      },
      {
        pvsPatientId: "ADV2-B",
        fullName: "Anna Becker",
        email: "anna.becker.adv2@gmail.com",
        phone: "017612345678",
        dob: "1990-07-22",
      },
    ],
  },
  {
    marker: "ADV-3-umlaut-folding",
    description:
      "Müller vs Mueller; same email + dob; MUST auto-merge via email-exact",
    expected: "auto-merge",
    patients: [
      {
        pvsPatientId: "ADV3-A",
        fullName: "Sophie Müller",
        email: "sophie.mueller.adv3@t-online.de",
        phone: "+491761000010",
        dob: "1978-11-04",
      },
      {
        pvsPatientId: "ADV3-B",
        fullName: "Sophie Mueller",
        email: "sophie.mueller.adv3@t-online.de",
        phone: "+491761000011",
        dob: "1978-11-04",
      },
    ],
  },
  {
    marker: "ADV-4-transposed-dob",
    description:
      "DOB 1985-03-12 vs 1985-12-03; transposed day/month; MUST NOT auto-merge (distinct emails)",
    expected: "review-queue",
    patients: [
      {
        pvsPatientId: "ADV4-A",
        fullName: "Stefan Klein",
        email: "stefan.klein.adv4a@gmail.com",
        phone: "+491761000020",
        dob: "1985-03-12",
      },
      {
        pvsPatientId: "ADV4-B",
        fullName: "Stefan Klein",
        email: "stefan.klein.adv4b@gmail.com",
        phone: "+491761000021",
        dob: "1985-12-03",
      },
    ],
  },
  {
    marker: "ADV-5-null-phone-shared-lastname",
    description:
      "Two Schneiders sharing DOB, no phone, no email; must NOT auto-merge",
    expected: "review-queue",
    patients: [
      {
        pvsPatientId: "ADV5-A",
        fullName: "Lena Schneider",
        dob: "1992-06-15",
      },
      {
        pvsPatientId: "ADV5-B",
        fullName: "Hannah Schneider",
        dob: "1992-06-15",
      },
    ],
  },
];

// ---------------------------------------------------------------
// Patient generation
// ---------------------------------------------------------------

interface SyntheticPatient {
  pvsPatientId: string;
  fullName: string;
  email: string;
  phone: string;
  dob: string;
  gender: "f" | "m";
}

function generatePatients(
  rng: () => number,
  count: number,
  seedRunId: string
): SyntheticPatient[] {
  const out: SyntheticPatient[] = [];
  for (let i = 0; i < count; i++) {
    const gender = rng() < 0.65 ? "f" : "m";
    const first = pick(rng, gender === "f" ? FIRST_NAMES_F : FIRST_NAMES_M);
    const last = pick(rng, LAST_NAMES);
    const year = int(rng, 1960, 2005);
    const month = int(rng, 1, 12);
    const day = int(rng, 1, 28);
    const dob = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const emailLocal = `${first}.${last}.${i}`
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss");
    const email = `${emailLocal}@${pick(rng, EMAIL_DOMAINS)}`;
    const phoneTail = String(int(rng, 1000000, 9999999));
    const phone = `+491${int(rng, 50, 79)}${phoneTail}`;
    out.push({
      pvsPatientId: `${seedRunId}-PAT-${i}`,
      fullName: `${first} ${last}`,
      email,
      phone,
      dob,
      gender,
    });
  }
  return out;
}

// ---------------------------------------------------------------
// Event generation
// ---------------------------------------------------------------

interface GeneratedEvents {
  patientUpserts: PvsEvent[];
  appointmentEvents: PvsEvent[];
  encounterAndInvoiceEvents: PvsEvent[];
  recallEvents: PvsEvent[];
}

function generateEventsForSoak(
  rng: () => number,
  patients: SyntheticPatient[],
  days: number,
  clinicId: string,
  seedRunId: string
): GeneratedEvents {
  const patientUpserts: PvsEvent[] = [];
  const appointmentEvents: PvsEvent[] = [];
  const encounterAndInvoiceEvents: PvsEvent[] = [];
  const recallEvents: PvsEvent[] = [];

  const now = Date.now();
  const windowStart = now - days * 24 * 60 * 60 * 1000;

  // 1) Every patient gets a single PatientUpserted, dated 30..60 days
  //    before "now" so the rest of the events have plausible scheduling
  //    against an existing patient row.
  for (const p of patients) {
    const upsertAt = windowStart + int(rng, 0, Math.floor(days * 0.2)) * 24 * 60 * 60 * 1000;
    patientUpserts.push({
      kind: "PatientUpserted",
      clinicId,
      bridgeSource: "gdt_agent",
      pvsExternalEventId: `${seedRunId}-upsert-${p.pvsPatientId}`,
      occurredAt: new Date(upsertAt).toISOString(),
      pvsPatientId: p.pvsPatientId,
      email: p.email,
      phone: p.phone,
      fullName: p.fullName,
      dob: p.dob,
      gender: p.gender,
    });
  }

  // 2) ~0.06 appointments/patient/day. For 10k patients × 60 days that
  //    is ~36k appointments; heavy enough to exercise the partitioning
  //    + derive pipeline meaningfully, light enough to seed in a few
  //    minutes against staging.
  const totalAppointments = Math.floor(patients.length * days * 0.06);
  for (let i = 0; i < totalAppointments; i++) {
    const patient = patients[int(rng, 0, patients.length - 1)]!;
    const dayOffset = int(rng, 0, days - 1);
    const scheduledAt = windowStart + dayOffset * 24 * 60 * 60 * 1000 + int(rng, 8, 18) * 60 * 60 * 1000;
    const treatment = pick(rng, TREATMENTS);
    const apptId = `${seedRunId}-APT-${i}`;

    appointmentEvents.push({
      kind: "AppointmentCreated",
      clinicId,
      bridgeSource: "gdt_agent",
      pvsExternalEventId: `${seedRunId}-aptcreate-${i}`,
      occurredAt: new Date(scheduledAt - 7 * 24 * 60 * 60 * 1000).toISOString(),
      pvsPatientId: patient.pvsPatientId,
      pvsAppointmentId: apptId,
      scheduledAt: new Date(scheduledAt).toISOString(),
      treatmentCode: treatment.code,
      treatmentLabel: treatment.label,
    });

    // Status: ~70% completed, 15% cancelled, 10% no-show, 5% still scheduled.
    const roll = rng();
    let newStatus: "completed" | "cancelled" | "no_show" | "scheduled";
    if (roll < 0.70) newStatus = "completed";
    else if (roll < 0.85) newStatus = "cancelled";
    else if (roll < 0.95) newStatus = "no_show";
    else newStatus = "scheduled";

    if (newStatus !== "scheduled") {
      const changedAt = scheduledAt + int(rng, 0, 60) * 60 * 1000;
      appointmentEvents.push({
        kind: "AppointmentStatusChanged",
        clinicId,
        bridgeSource: "gdt_agent",
        pvsExternalEventId: `${seedRunId}-aptstatus-${i}`,
        occurredAt: new Date(changedAt).toISOString(),
        pvsPatientId: patient.pvsPatientId,
        pvsAppointmentId: apptId,
        newStatus,
        changedAt: new Date(changedAt).toISOString(),
      });
    }

    // Completed appointments produce an Encounter + Invoice + sometimes Recall.
    if (newStatus === "completed") {
      const completedAt = scheduledAt + int(rng, 30, 120) * 60 * 1000;
      const encounterId = `${seedRunId}-ENC-${i}`;
      encounterAndInvoiceEvents.push({
        kind: "EncounterCompleted",
        clinicId,
        bridgeSource: "gdt_agent",
        pvsExternalEventId: `${seedRunId}-enc-${i}`,
        occurredAt: new Date(completedAt).toISOString(),
        pvsPatientId: patient.pvsPatientId,
        pvsEncounterId: encounterId,
        pvsAppointmentId: apptId,
        treatmentCode: treatment.code,
        treatmentLabel: treatment.label,
        completedAt: new Date(completedAt).toISOString(),
      });

      const paidAt = completedAt + int(rng, 0, 7) * 24 * 60 * 60 * 1000;
      const amountCents = int(
        rng,
        treatment.priceMinCents,
        treatment.priceMaxCents
      );
      encounterAndInvoiceEvents.push({
        kind: "InvoicePaid",
        clinicId,
        bridgeSource: "gdt_agent",
        pvsExternalEventId: `${seedRunId}-inv-${i}`,
        occurredAt: new Date(paidAt).toISOString(),
        pvsPatientId: patient.pvsPatientId,
        pvsInvoiceId: `${seedRunId}-INV-${i}`,
        pvsAppointmentId: apptId,
        pvsEncounterId: encounterId,
        amountCents,
        currency: "EUR",
        paidAt: new Date(paidAt).toISOString(),
      });

      // 30% of completed appointments produce a follow-up Recall.
      if (rng() < 0.30) {
        const recallAt = completedAt + int(rng, 30, 90) * 24 * 60 * 60 * 1000;
        recallEvents.push({
          kind: "RecallScheduled",
          clinicId,
          bridgeSource: "gdt_agent",
          pvsExternalEventId: `${seedRunId}-recall-${i}`,
          occurredAt: new Date(completedAt).toISOString(),
          pvsPatientId: patient.pvsPatientId,
          pvsRecallId: `${seedRunId}-RCL-${i}`,
          recallAt: new Date(recallAt).toISOString(),
          treatmentCode: treatment.code,
          treatmentLabel: treatment.label,
        });
      }
    }
  }

  return {
    patientUpserts,
    appointmentEvents,
    encounterAndInvoiceEvents,
    recallEvents,
  };
}

function adversarialUpserts(
  clinicId: string,
  seedRunId: string
): PvsEvent[] {
  const out: PvsEvent[] = [];
  const baseTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const fixture of ADVERSARIAL_PAIRS) {
    for (let i = 0; i < fixture.patients.length; i++) {
      const p = fixture.patients[i]!;
      out.push({
        kind: "PatientUpserted",
        clinicId,
        bridgeSource: "gdt_agent",
        pvsExternalEventId: `${seedRunId}-adv-${fixture.marker}-${i}`,
        occurredAt: new Date(baseTime + i * 60 * 1000).toISOString(),
        pvsPatientId: p.pvsPatientId,
        email: p.email,
        phone: p.phone,
        fullName: p.fullName,
        dob: p.dob,
        gender: "f",
        // Tag with the marker so a soak reviewer can grep
        // linking_failures.candidates for this fixture.
        bemerkung: `seed:${seedRunId} fixture:${fixture.marker} expected:${fixture.expected}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Safety rails
// ---------------------------------------------------------------

function assertNotProduction(): void {
  const url = process.env.DATABASE_URL ?? "";
  const lowered = url.toLowerCase();
  if (
    lowered.includes("portal.eins.ag") ||
    lowered.includes("prod") ||
    lowered.includes("production")
  ) {
    console.error(
      "[pvs-seed-staging] REFUSING: DATABASE_URL looks like production."
    );
    console.error(
      `   set DATABASE_URL to your staging cluster before re-running.`
    );
    process.exit(1);
  }
}

async function assertClinicLooksLikeStaging(clinicId: string): Promise<void> {
  const [tag] = await db
    .select({
      patientCount: sql<number>`(SELECT count(*)::int FROM patients WHERE clinic_id = ${clinicId})`,
      requestCount: sql<number>`(SELECT count(*)::int FROM requests WHERE clinic_id = ${clinicId})`,
      hasStagingUser: sql<boolean>`EXISTS (
        SELECT 1 FROM clinic_users
         WHERE clinic_id = ${clinicId}
           AND email LIKE 'staging-%'
      )`,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!tag) {
    console.error(`[pvs-seed-staging] clinic_id ${clinicId} not found`);
    process.exit(1);
  }
  const safe =
    tag.hasStagingUser === true ||
    (tag.patientCount + tag.requestCount) < 50;
  if (!safe) {
    console.error(
      `[pvs-seed-staging] REFUSING: clinic ${clinicId} has ${tag.patientCount} patients + ${tag.requestCount} requests and no staging-tagged user.`
    );
    console.error(
      `   This looks like a real clinic. Add a clinic_users row with email LIKE 'staging-%' to opt in, or pick a different clinic_id.`
    );
    process.exit(1);
  }
}

async function assertLinkExists(clinicId: string): Promise<void> {
  const [link] = await db
    .select({
      vendor: schema.pvsLink.pvsVendor,
      status: schema.pvsLink.status,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, clinicId))
    .limit(1);
  if (!link) {
    console.error(
      `[pvs-seed-staging] REFUSING: no pvs_link row for clinic ${clinicId}.`
    );
    console.error(
      `   Create one first (status='connected', vendor='gdt_agent') or run the agent enrollment flow.`
    );
    process.exit(1);
  }
  if (link.status !== "connected" && link.status !== "akkreditierung") {
    console.error(
      `[pvs-seed-staging] WARNING: pvs_link.status='${link.status}'; events will quarantine. ` +
        `Confirm the link in the portal UI or accept quarantined events as part of the soak.`
    );
  }
  if (link.vendor !== "gdt_agent" && link.vendor !== "csv_upload") {
    console.error(
      `[pvs-seed-staging] WARNING: pvs_link.vendor='${link.vendor}'; vendor-mismatch will reject events.`
    );
  }
}

// ---------------------------------------------------------------
// Apply loop
// ---------------------------------------------------------------

interface ApplyTally {
  ingested: number;
  deduped: number;
  quarantined: number;
  failed: number;
  failures: Array<{ kind: string; reason: string; count: number }>;
}

async function applyEvents(events: PvsEvent[]): Promise<ApplyTally> {
  const tally: ApplyTally = {
    ingested: 0,
    deduped: 0,
    quarantined: 0,
    failed: 0,
    failures: [],
  };
  const failureCounts = new Map<string, { kind: string; count: number }>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    try {
      const result = await applyPvsEvent(ev);
      if (!result.ok) {
        tally.failed += 1;
        const key = `${ev.kind}::${result.reason}`;
        const entry = failureCounts.get(key);
        if (entry) entry.count += 1;
        else failureCounts.set(key, { kind: ev.kind, count: 1 });
        continue;
      }
      if (result.status === "deduped") tally.deduped += 1;
      else if (result.status === "quarantined") tally.quarantined += 1;
      else tally.ingested += 1;
    } catch (err) {
      tally.failed += 1;
      const key = `${ev.kind}::threw`;
      const entry = failureCounts.get(key);
      if (entry) entry.count += 1;
      else failureCounts.set(key, { kind: ev.kind, count: 1 });
      console.error(
        `[pvs-seed-staging] event #${i} (${ev.kind}) threw:`,
        (err as Error).message
      );
    }
    if (i > 0 && i % 500 === 0) {
      process.stdout.write(
        `  progress: ${i}/${events.length} (${Math.round((i / events.length) * 100)}%)\n`
      );
    }
  }

  tally.failures = Array.from(failureCounts.entries()).map(
    ([key, value]) => ({
      kind: value.kind,
      reason: key.split("::")[1] ?? "unknown",
      count: value.count,
    })
  );
  return tally;
}

// ---------------------------------------------------------------
// Manifest write
// ---------------------------------------------------------------

interface Manifest {
  seedRunId: string;
  clinicId: string;
  startedAt: string;
  finishedAt: string;
  patientCount: number;
  daysSpanned: number;
  rngSeed: number;
  adversarialFixtures: Array<{
    marker: string;
    description: string;
    expected: "auto-merge" | "review-queue" | "new-patient";
    patients: Array<{ pvsPatientId: string; fullName: string; dob: string }>;
  }>;
  totals: {
    patientUpserts: number;
    appointmentEvents: number;
    encounterAndInvoiceEvents: number;
    recallEvents: number;
    adversarialUpserts: number;
  };
  ingestTally: ApplyTally | null;
}

async function writeManifest(manifest: Manifest, outPath: string | undefined): Promise<void> {
  if (!outPath) {
    console.log("\nmanifest (--out not specified, printed only):");
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nmanifest written to ${outPath}`);
}

// ---------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "pvs-seed-staging; generate synthetic PVS events for the staging soak (P3-2)"
    );
    console.log("");
    console.log(
      "Usage: pnpm --filter portal tsx scripts/pvs-seed-staging.ts \\\n" +
        "         --clinic-id <UUID> [--patients N] [--days N] [--seed N] [--out PATH] [--apply]"
    );
    process.exit(0);
  }

  const clinicId = requireFlag(argv, "--clinic-id");
  const patients = Number(flag(argv, "--patients") ?? 10000);
  const days = Number(flag(argv, "--days") ?? 60);
  const seed = Number(flag(argv, "--seed") ?? 1);
  const out = flag(argv, "--out");
  const apply = boolFlag(argv, "--apply");

  if (!Number.isFinite(patients) || patients < 1 || patients > 200_000) {
    console.error("error: --patients must be 1..200000");
    process.exit(2);
  }
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    console.error("error: --days must be 1..365");
    process.exit(2);
  }

  assertNotProduction();
  await assertClinicLooksLikeStaging(clinicId);
  await assertLinkExists(clinicId);

  const startedAt = new Date().toISOString();
  const seedRunId = `soak-${Date.now()}-s${seed}`;
  const rng = makeRng(seed);

  console.log("");
  console.log(`pvs-seed-staging (${apply ? "APPLY" : "dry-run"})`);
  console.log(`  clinic:        ${clinicId}`);
  console.log(`  seed_run_id:   ${seedRunId}`);
  console.log(`  patients:      ${patients}`);
  console.log(`  days:          ${days}`);
  console.log(`  rng seed:      ${seed}`);

  const cohort = generatePatients(rng, patients, seedRunId);
  const events = generateEventsForSoak(rng, cohort, days, clinicId, seedRunId);
  const adv = adversarialUpserts(clinicId, seedRunId);

  const totals = {
    patientUpserts: events.patientUpserts.length,
    appointmentEvents: events.appointmentEvents.length,
    encounterAndInvoiceEvents: events.encounterAndInvoiceEvents.length,
    recallEvents: events.recallEvents.length,
    adversarialUpserts: adv.length,
  };

  console.log("");
  console.log("generated event counts:");
  console.log(`  patient-upserts:           ${totals.patientUpserts}`);
  console.log(`  appointment-events:        ${totals.appointmentEvents}`);
  console.log(`  encounter+invoice events:  ${totals.encounterAndInvoiceEvents}`);
  console.log(`  recall events:             ${totals.recallEvents}`);
  console.log(`  adversarial upserts:       ${totals.adversarialUpserts}`);
  console.log(
    `  TOTAL:                     ${
      totals.patientUpserts +
      totals.appointmentEvents +
      totals.encounterAndInvoiceEvents +
      totals.recallEvents +
      totals.adversarialUpserts
    }`
  );

  const manifest: Manifest = {
    seedRunId,
    clinicId,
    startedAt,
    finishedAt: startedAt,
    patientCount: patients,
    daysSpanned: days,
    rngSeed: seed,
    adversarialFixtures: ADVERSARIAL_PAIRS.map((p) => ({
      marker: p.marker,
      description: p.description,
      expected: p.expected,
      patients: p.patients.map(({ pvsPatientId, fullName, dob }) => ({
        pvsPatientId,
        fullName,
        dob,
      })),
    })),
    totals,
    ingestTally: null,
  };

  if (!apply) {
    console.log(
      "\ndry-run: nothing was written. Pass --apply to ingest, --out PATH to persist manifest."
    );
    await writeManifest(manifest, out);
    process.exit(0);
  }

  // Apply in a sensible order: adversarials first so they're easy to
  // grep for in the linker logs, then upserts, then dependent events.
  console.log("\napplying adversarial fixtures…");
  const advTally = await applyEvents(adv);

  console.log("applying patient upserts…");
  const upsertTally = await applyEvents(events.patientUpserts);

  console.log("applying appointment events…");
  const apptTally = await applyEvents(events.appointmentEvents);

  console.log("applying encounter + invoice events…");
  const encTally = await applyEvents(events.encounterAndInvoiceEvents);

  console.log("applying recall events…");
  const recallTally = await applyEvents(events.recallEvents);

  manifest.finishedAt = new Date().toISOString();
  manifest.ingestTally = {
    ingested:
      advTally.ingested +
      upsertTally.ingested +
      apptTally.ingested +
      encTally.ingested +
      recallTally.ingested,
    deduped:
      advTally.deduped +
      upsertTally.deduped +
      apptTally.deduped +
      encTally.deduped +
      recallTally.deduped,
    quarantined:
      advTally.quarantined +
      upsertTally.quarantined +
      apptTally.quarantined +
      encTally.quarantined +
      recallTally.quarantined,
    failed:
      advTally.failed +
      upsertTally.failed +
      apptTally.failed +
      encTally.failed +
      recallTally.failed,
    failures: [
      ...advTally.failures,
      ...upsertTally.failures,
      ...apptTally.failures,
      ...encTally.failures,
      ...recallTally.failures,
    ],
  };

  console.log("\ntotal ingest tally:");
  console.log(JSON.stringify(manifest.ingestTally, null, 2));

  await writeManifest(manifest, out);
  process.exit(0);
}

main().catch((err) => {
  console.error("[pvs-seed-staging] fatal:", err);
  process.exit(1);
});
