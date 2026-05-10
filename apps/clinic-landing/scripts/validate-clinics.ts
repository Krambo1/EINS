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
  listClinics,
  listTreatmentsForClinic,
} from "../lib/clinic-registry";
import { clinicSchema, treatmentSchema } from "../lib/schema";

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
