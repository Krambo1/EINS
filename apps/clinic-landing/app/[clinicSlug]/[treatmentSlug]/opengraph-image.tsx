import { ImageResponse } from "next/og";
import { getClinic, getTreatment } from "@/lib/clinic-registry";

export const alt = "Beratungstermin";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "edge";

export default async function OpenGraphImage({
  params,
}: {
  params: { clinicSlug: string; treatmentSlug: string };
}) {
  const clinic = getClinic(params.clinicSlug);
  const treatment = getTreatment(params.clinicSlug, params.treatmentSlug);

  const fallback = {
    bg: "#ffffff",
    fg: "#15151b",
    primary: "#1e3a5f",
    name: "Praxis",
    h1: "Beratungstermin",
  };
  const bg = clinic?.brand.bg ?? fallback.bg;
  const fg = clinic?.brand.fg ?? fallback.fg;
  const primary = clinic?.brand.primary ?? fallback.primary;
  const name = clinic?.name ?? fallback.name;
  const h1 = treatment?.h1 ?? fallback.h1;
  const city = treatment?.city ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: bg,
          color: fg,
          padding: 64,
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: primary,
            letterSpacing: "-0.02em",
          }}
        >
          {name}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: "-0.025em",
              maxWidth: 1000,
            }}
          >
            {h1}
          </div>
          {city && (
            <div style={{ marginTop: 16, fontSize: 28, opacity: 0.7 }}>
              {city}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 24,
            color: primary,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 9999,
              background: primary,
            }}
          />
          Beratungstermin vereinbaren
        </div>
      </div>
    ),
    { ...size },
  );
}
