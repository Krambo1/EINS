/**
 * Static clinic + treatment registry.
 *
 * Every clinic config is imported eagerly so Next.js can:
 *   1. Statically generate every <slug>/<treatment> route at build time
 *   2. Validate every config via zod on first import (dev sanity)
 *   3. Build the host → slug map for middleware rewrites
 *
 * Adding a new clinic:
 *   1. `cp -r clinics/_template clinics/<new-slug>`
 *   2. Edit `clinics/<new-slug>/clinic.ts` and `clinics/<new-slug>/treatments/*.ts`
 *   3. Append imports below — TypeScript will refuse to build if the shape is wrong
 *
 * The template itself (`_template`) is also registered: it's the canonical demo
 * for QA and the seed for new clinic onboardings. It does NOT receive a custom
 * domain — only the `_template.clinic-landing.vercel.app/<treatment>` preview URL.
 */

import type { Clinic, Treatment } from "./types";
import { clinicSchema, treatmentSchema } from "./schema";

import { templateClinic } from "@/clinics/_template/clinic";
import { templateBotox } from "@/clinics/_template/treatments/botox";
import { templateFiller } from "@/clinics/_template/treatments/filler";
import { templateLidOp } from "@/clinics/_template/treatments/lid-op";
import { templateLiposuktion } from "@/clinics/_template/treatments/liposuktion";
import { templateBrust } from "@/clinics/_template/treatments/brust";
import { templateRhino } from "@/clinics/_template/treatments/rhino";
import { templateAntiAging } from "@/clinics/_template/treatments/anti-aging";

interface RegistryEntry {
  clinic: Clinic;
  treatments: Map<string, Treatment>;
}

function buildEntry(clinic: Clinic, treatments: Treatment[]): RegistryEntry {
  // Guard against typo'd clinicSlug — if a treatment claims a different parent,
  // fail loudly instead of routing it to the wrong domain.
  for (const t of treatments) {
    if (t.clinicSlug !== clinic.slug) {
      throw new Error(
        `Treatment ${t.slug} declares clinicSlug="${t.clinicSlug}" but is registered under clinic ${clinic.slug}`,
      );
    }
  }
  return {
    clinic,
    treatments: new Map(treatments.map((t) => [t.slug, t])),
  };
}

const ENTRIES: RegistryEntry[] = [
  buildEntry(templateClinic, [
    templateBotox,
    templateFiller,
    templateLidOp,
    templateLiposuktion,
    templateBrust,
    templateRhino,
    templateAntiAging,
  ]),
];

/** Validate every entry exactly once on module load. */
let VALIDATED = false;
function validate() {
  if (VALIDATED) return;
  VALIDATED = true;
  for (const { clinic, treatments } of ENTRIES) {
    const cParse = clinicSchema.safeParse(clinic);
    if (!cParse.success) {
      throw new Error(
        `Clinic "${clinic.slug}" failed schema validation:\n${JSON.stringify(cParse.error.format(), null, 2)}`,
      );
    }
    for (const treatment of treatments.values()) {
      const tParse = treatmentSchema.safeParse(treatment);
      if (!tParse.success) {
        throw new Error(
          `Treatment "${clinic.slug}/${treatment.slug}" failed schema validation:\n${JSON.stringify(tParse.error.format(), null, 2)}`,
        );
      }
    }
  }
}

const REGISTRY: Map<string, RegistryEntry> = (() => {
  validate();
  const m = new Map<string, RegistryEntry>();
  for (const e of ENTRIES) m.set(e.clinic.slug, e);
  return m;
})();

export function getClinic(slug: string): Clinic | null {
  return REGISTRY.get(slug)?.clinic ?? null;
}

export function getTreatment(clinicSlug: string, treatmentSlug: string): Treatment | null {
  return REGISTRY.get(clinicSlug)?.treatments.get(treatmentSlug) ?? null;
}

export function listClinics(): Clinic[] {
  return [...REGISTRY.values()].map((e) => e.clinic);
}

export function listTreatmentsForClinic(clinicSlug: string): Treatment[] {
  const e = REGISTRY.get(clinicSlug);
  return e ? [...e.treatments.values()] : [];
}

/**
 * The `_template` clinic is a placeholder full of `[Stadt]`, `[Praxis-Name]`,
 * etc. tokens — invaluable for local previews, but a brand-damaging leak if
 * it ever renders to real traffic. We keep it loaded for dev/preview QA but
 * exclude it from static generation in production builds. Combined with
 * `dynamicParams = false` on the route, that means `/_template/*` returns
 * 404 in production.
 */
const EXPOSE_TEMPLATE =
  process.env.EXPOSE_CLINIC_TEMPLATE === "1" ||
  process.env.VERCEL_ENV === "preview" ||
  process.env.NODE_ENV !== "production";

export function listAllRoutes(): { clinicSlug: string; treatmentSlug: string }[] {
  const out: { clinicSlug: string; treatmentSlug: string }[] = [];
  for (const { clinic, treatments } of REGISTRY.values()) {
    if (clinic.slug === "_template" && !EXPOSE_TEMPLATE) continue;
    for (const t of treatments.values()) {
      out.push({ clinicSlug: clinic.slug, treatmentSlug: t.slug });
    }
  }
  return out;
}

/**
 * True if the given clinic slug should be hidden from public traffic. The
 * page-level guard uses this to return 404 even if `dynamicParams` is
 * relaxed in the future.
 */
export function isHiddenClinicSlug(slug: string): boolean {
  return slug === "_template" && !EXPOSE_TEMPLATE;
}
