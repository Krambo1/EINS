/**
 * Build-time clinic + treatment validator.
 *
 * Runs as part of `pnpm build`. Performs:
 *   1. zod schema validation of every Clinic and Treatment config
 *   2. Verifies that every referenced public asset (logo, portrait, hero image,
 *      practice photos, font files) exists on disk
 *   3. Verifies domain uniqueness across the whole registry
 *   4. Surfaces the first failure with a clear path to the offending file
 *
 * Exit code:
 *   0  — all good
 *   1  — at least one config or asset failed
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getClinic,
  getTreatmentByCode,
  listClinics,
  listTreatmentsForClinic,
  urlCodeProblems,
} from "../lib/clinic-registry";
import { clinicSchema, treatmentSchema } from "../lib/schema";
import { practicePrivacyProblems } from "../lib/legal/practice-privacy";
import { practiceStartMetadata } from "../lib/seo";

const ROOT = resolve(__dirname, "..");
const PUBLIC_ROOT = resolve(ROOT, "public");

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`✖ ${msg}`);
};
const ok = (msg: string) => console.log(`✔ ${msg}`);

function checkAsset(label: string, src: string): void {
  if (!src) return;
  // Strip leading slash; assets live in /public.
  const rel = src.startsWith("/") ? src.slice(1) : src;
  const abs = resolve(PUBLIC_ROOT, rel);
  if (!existsSync(abs)) fail(`${label}: file does not exist → ${abs}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Config errors always fail. Missing env vars fail only on a Vercel
 * production build (VERCEL_ENV=production), where the runtime env is
 * present at build time, and only for real clinics; locally and for
 * `_`-prefixed demo slugs they are a warning.
 */
function checkPortalRelayConfig(slug: string, portalClinicId: string, secretEnv: string): void {
  if (!portalClinicId) {
    console.warn(`! ${slug}: portalClinicId is empty, form inquiries do NOT reach the portal`);
    return;
  }
  if (!UUID_RE.test(portalClinicId)) fail(`${slug}: portalClinicId is not a UUID`);
  if (!secretEnv) {
    fail(`${slug}: portalClinicId is set but portalIntakeSecretEnv is empty`);
    return;
  }
  const missing: string[] = [];
  if (!process.env.PORTAL_URL) missing.push("PORTAL_URL");
  if (!process.env[secretEnv]) missing.push(secretEnv);
  if (missing.length === 0) {
    ok(`  portal relay configured → ${slug}`);
    return;
  }
  const msg = `${slug}: env ${missing.join(", ")} not set, every form inquiry would fail`;
  // `_`-prefixed slugs are demo/template pages: warn, never block a deploy.
  if (process.env.VERCEL_ENV === "production" && !slug.startsWith("_")) fail(msg);
  else console.warn(`! ${msg} (warning only)`);
}

/** Route segments next to the treatment pages; a urlCode equal to one would be shadowed. */
const RESERVED_SEGMENTS = new Set(["datenschutz", "impressum", "opengraph-image"]);

function deumlaut(s: string): string {
  return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

function practiceStartProblems(slug: string): string[] {
  const clinic = getClinic(slug);
  if (!clinic) return ["clinic not found"];
  const treatments = listTreatmentsForClinic(slug);
  const out: string[] = [];
  if (treatments.length === 0) out.push("no treatments, the treatment choice would be empty");
  for (const t of treatments) {
    if (RESERVED_SEGMENTS.has(t.urlCode)) out.push(`urlCode "${t.urlCode}" (${t.slug}) collides with a page route`);
    if (getTreatmentByCode(slug, t.urlCode) !== t) out.push(`urlCode "${t.urlCode}" (${t.slug}) does not resolve to this treatment`);
  }
  // Title and description must not name a treatment (pixels send the title).
  const meta = practiceStartMetadata(clinic);
  const title = typeof meta.title === "object" && meta.title && "absolute" in meta.title ? meta.title.absolute : String(meta.title ?? "");
  const text = deumlaut(`${title} ${meta.description ?? ""}`);
  const city = deumlaut(clinic.address.city);
  for (const t of treatments) {
    const words = new Set(
      [t.category === "other" ? "" : t.category, ...t.slug.split("-"), ...t.category.split("-")]
        .map(deumlaut)
        .filter((w) => w.length >= 4 && !city.includes(w)),
    );
    for (const w of words) {
      if (text.includes(w)) {
        out.push(`title/description contain the treatment word "${w}" (${t.slug})`);
        break;
      }
    }
  }
  return out;
}

function main() {
  const clinics = listClinics();
  if (clinics.length === 0) {
    fail("Registry is empty — no clinics registered.");
    return finish();
  }

  // Domain uniqueness
  const domainOwners = new Map<string, string>();
  for (const c of clinics) {
    for (const d of c.domains) {
      const norm = d.toLowerCase();
      const owner = domainOwners.get(norm);
      if (owner && owner !== c.slug) {
        fail(`Domain conflict: "${norm}" claimed by both ${owner} and ${c.slug}`);
      }
      domainOwners.set(norm, c.slug);
    }
  }

  for (const clinic of clinics) {
    const cParse = clinicSchema.safeParse(clinic);
    if (!cParse.success) {
      fail(
        `Clinic "${clinic.slug}" failed schema:\n${JSON.stringify(cParse.error.flatten(), null, 2)}`,
      );
      continue;
    }
    ok(`clinic schema valid → ${clinic.slug}`);

    checkAsset(`${clinic.slug}.logo`, clinic.logo);
    checkAsset(`${clinic.slug}.doctor.portrait`, clinic.doctor.portrait);
    for (const img of clinic.practiceImages ?? []) {
      checkAsset(`${clinic.slug}.practiceImages`, img.src);
    }
    for (const f of clinic.brand.fonts ?? []) {
      const path = `/clinics/${clinic.slug}/fonts/${f.filename}`;
      checkAsset(`${clinic.slug}.brand.fonts`, path);
    }

    // Neutral page addresses: ad pixels send the full URL, so the public
    // segment (urlCode) must never name the treatment.
    const codeProblems = urlCodeProblems(clinic.slug);
    for (const p of codeProblems) fail(`${clinic.slug}: ${p}`);
    if (codeProblems.length === 0) ok(`  url codes neutral + unique → ${clinic.slug}`);

    // Practice start page (app/[clinicSlug]/page.tsx): lists the treatments
    // by urlCode, and its title / description go to the pixels.
    const startProblems = practiceStartProblems(clinic.slug);
    for (const p of startProblems) fail(`${clinic.slug}: start page: ${p}`);
    if (startProblems.length === 0) ok(`  start page neutral + links valid → ${clinic.slug}`);

    if (clinic.slug !== "_template") {
      for (const problem of practicePrivacyProblems(clinic)) fail(`${clinic.slug}: ${problem}`);
    }

    // Portal relay: with a portalClinicId every form submit must reach the
    // portal, and the form shows an error when it cannot. Missing config
    // would make every inquiry fail, so catch it at build time.
    checkPortalRelayConfig(clinic.slug, clinic.portalClinicId, clinic.portalIntakeSecretEnv);

    for (const treatment of listTreatmentsForClinic(clinic.slug)) {
      const tParse = treatmentSchema.safeParse(treatment);
      if (!tParse.success) {
        fail(
          `Treatment "${clinic.slug}/${treatment.slug}" failed schema:\n${JSON.stringify(tParse.error.flatten(), null, 2)}`,
        );
        continue;
      }
      ok(`  treatment schema valid → ${clinic.slug}/${treatment.slug}`);
      checkAsset(`${clinic.slug}/${treatment.slug}.heroImage`, treatment.heroImage.src);
      if (treatment.heroVideo) {
        checkAsset(`${clinic.slug}/${treatment.slug}.heroVideo.mp4`, treatment.heroVideo.mp4);
        checkAsset(`${clinic.slug}/${treatment.slug}.heroVideo.poster`, treatment.heroVideo.poster);
        if (treatment.heroVideo.webm)
          checkAsset(`${clinic.slug}/${treatment.slug}.heroVideo.webm`, treatment.heroVideo.webm);
      }
      if (treatment.seo.ogImage) {
        checkAsset(`${clinic.slug}/${treatment.slug}.seo.ogImage`, treatment.seo.ogImage);
      }
    }
  }

  finish();
}

function finish() {
  if (failures > 0) {
    console.error(`\n${failures} validation failure(s). Aborting.`);
    process.exit(1);
  }
  console.log("\nAll clinic configs and assets validated.");
}

main();
