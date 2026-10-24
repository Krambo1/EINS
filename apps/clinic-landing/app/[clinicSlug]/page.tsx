import { notFound } from "next/navigation";
import {
  getClinic,
  isHiddenClinicSlug,
  listClinics,
  listTreatmentsForClinic,
} from "@/lib/clinic-registry";
import { practiceStartMetadata } from "@/lib/seo";
import { PracticeStart } from "@/components/sections/practice-start";
import { MetaPixel } from "@/components/tracking/meta-pixel";
import { GoogleAds } from "@/components/tracking/google-ads";
import { TikTokPixel } from "@/components/tracking/tiktok-pixel";

/**
 * Practice start page. middleware.ts rewrites the bare practice domain to
 * `/<clinicSlug>`; internal hosts reach it directly. Organic links (profile
 * link, DM, story, post) land here with utm_source=instagram and, for posts,
 * utm_content=<post code>.
 *
 * Same privacy rules as the treatment pages: the layout's attribution script
 * cleans the address before any pixel, the title names no treatment
 * (practiceStartMetadata), consent banner from the layout, pixels are
 * consent-gated inside their components (Meta: PageView only).
 */

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
  return listClinics()
    .filter((c) => !isHiddenClinicSlug(c.slug))
    .map((c) => ({ clinicSlug: c.slug }));
}

interface PageProps {
  params: { clinicSlug: string };
}

export function generateMetadata({ params }: PageProps) {
  if (isHiddenClinicSlug(params.clinicSlug)) return {};
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) return {};
  return practiceStartMetadata(clinic);
}

export default function PracticeStartPage({ params }: PageProps) {
  if (isHiddenClinicSlug(params.clinicSlug)) notFound();
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) notFound();

  return (
    <>
      <PracticeStart clinic={clinic} treatments={listTreatmentsForClinic(clinic.slug)} />

      {/* Tracking: all consent-gated inside the components themselves. */}
      {clinic.connectors.metaPixelId && <MetaPixel pixelId={clinic.connectors.metaPixelId} />}
      {clinic.connectors.googleAdsId && <GoogleAds adsId={clinic.connectors.googleAdsId} />}
      {clinic.connectors.tiktokPixelId && <TikTokPixel pixelId={clinic.connectors.tiktokPixelId} />}
    </>
  );
}
