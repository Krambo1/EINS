import { ImageResponse } from "next/og";

// Edge runtime: uses the edge build of @vercel/og (avoids the Node
// fileURLToPath "Invalid URL" prerender error in Next 14 on Node 20+).
export const runtime = "edge";

// Dynamic 1200x630 social card. Replaces the old /eins-logo.png OG image so
// shares on LinkedIn/WhatsApp/Slack render a designed card, not a bare logo.
// Next.js wires the og:image (and twitter:image fallback) automatically.

export const alt = "EINS - Wachstumssystem für Ästhetik-Praxen";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              fontSize: 52,
              fontWeight: 800,
              letterSpacing: -2,
              color: "#10101a",
            }}
          >
            EINS
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.04,
              letterSpacing: -3,
              color: "#10101a",
            }}
          >
            Mehr Selbstzahler.
          </div>
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.04,
              letterSpacing: -3,
              color: "#2e8580",
            }}
          >
            Mehr Umsatz. Mehr Sicherheit.
          </div>
          <div style={{ marginTop: 28, fontSize: 34, color: "#3f3f48" }}>
            Das integrierte Wachstumssystem für Ästhetik-Praxen.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              height: 12,
              width: "100%",
              borderRadius: 999,
              background: "linear-gradient(90deg, #58BAB5, #64CEC9)",
            }}
          />
          <div style={{ marginTop: 20, fontSize: 26, color: "#6a6a74" }}>
            eins.ag · Deutschland · Österreich · Schweiz
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
