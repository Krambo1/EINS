import { notFound } from "next/navigation";
import {
  getClinic,
  getTreatment,
  isHiddenClinicSlug,
  listAllRoutes,
} from "@/lib/clinic-registry";
import { treatmentMetadata } from "@/lib/seo";
import { buildJsonLd } from "@/lib/jsonld";
import { StickyNav } from "@/components/sections/sticky-nav";
import { Hero } from "@/components/sections/hero";
import { TrustBar } from "@/components/sections/trust-bar";
import { ProblemMirror } from "@/components/sections/problem-mirror";
import { DoctorSection } from "@/components/sections/doctor-section";
import { TreatmentExplainer } from "@/components/sections/treatment-explainer";
import { ResultsTease } from "@/components/sections/results-tease";
import { Testimonials } from "@/components/sections/testimonials";
import { ProcessSteps } from "@/components/sections/process-steps";
import { CostSection } from "@/components/sections/cost-section";
import { FAQ } from "@/components/sections/faq";
import { FinalCta } from "@/components/sections/final-cta";
import { StickyBottomCta } from "@/components/sections/sticky-bottom-cta";
import { Footer } from "@/components/sections/footer";
import { MetaPixel } from "@/components/tracking/meta-pixel";
import { GoogleAds } from "@/components/tracking/google-ads";
import { TikTokPixel } from "@/components/tracking/tiktok-pixel";
import { RumReporter } from "@/components/tracking/rum";

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
  return listAllRoutes();
}

interface PageProps {
  params: { clinicSlug: string; treatmentSlug: string };
}

export function generateMetadata({ params }: PageProps) {
  if (isHiddenClinicSlug(params.clinicSlug)) return {};
  const clinic = getClinic(params.clinicSlug);
  const treatment = getTreatment(params.clinicSlug, params.treatmentSlug);
  if (!clinic || !treatment) return {};
  return treatmentMetadata(clinic, treatment);
}

export default function TreatmentPage({ params }: PageProps) {
  // Hard guard so the placeholder `_template` config never renders for real
  // traffic, even if `dynamicParams` is relaxed later or someone hand-rolls
  // the URL on the preview host.
  if (isHiddenClinicSlug(params.clinicSlug)) notFound();

  const clinic = getClinic(params.clinicSlug);
  const treatment = getTreatment(params.clinicSlug, params.treatmentSlug);
  if (!clinic || !treatment) notFound();

  const apexHttps = clinic.domains[0] ? `https://${clinic.domains[0]}` : "";
  const pageUrl = `${apexHttps}/${treatment.slug}`;
  const jsonld = buildJsonLd(clinic, treatment, pageUrl);
  const pageViewEventId = `${treatment.slug}-${Date.now().toString(36)}`;
  const privacyHref = `/${clinic.slug}/datenschutz`;

  return (
    <>
      {jsonld.map((doc, i) => (
        <script
          key={i}
          type="application/ld+json"
          // Escape `<` so a clinic/treatment field containing `</script>`
          // can't break out of the JSON-LD block (pentest L6). JSON.stringify
          // does not escape it on its own.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(doc).replace(/</g, "\\u003c") }}
        />
      ))}

      <StickyNav clinic={clinic} treatment={treatment} />
      <main>
        {/* Section order = conversion order: quiz in the hero, authority
            before the ask, proof + cost transparency for the scrollers. */}
        <Hero clinic={clinic} treatment={treatment} privacyHref={privacyHref} />
        <TrustBar clinic={clinic} />
        <ProblemMirror treatment={treatment} />
        <DoctorSection clinic={clinic} />
        <TreatmentExplainer treatment={treatment} />
        <ResultsTease clinic={clinic} />
        <Testimonials clinic={clinic} />
        <ProcessSteps treatment={treatment} />
        <CostSection clinic={clinic} treatment={treatment} />
        <FAQ treatment={treatment} />
        <FinalCta clinic={clinic} treatment={treatment} />
      </main>
      <Footer clinic={clinic} />
      <StickyBottomCta clinic={clinic} treatment={treatment} />

      {/* Tracking — all consent-gated inside the components themselves. */}
      {clinic.connectors.metaPixelId && (
        <MetaPixel
          pixelId={clinic.connectors.metaPixelId}
          pageViewEventId={pageViewEventId}
        />
      )}
      {clinic.connectors.googleAdsId && (
        <GoogleAds adsId={clinic.connectors.googleAdsId} />
      )}
      {clinic.connectors.tiktokPixelId && (
        <TikTokPixel pixelId={clinic.connectors.tiktokPixelId} />
      )}
      <RumReporter clinicSlug={clinic.slug} treatmentSlug={treatment.slug} />
    </>
  );
}
