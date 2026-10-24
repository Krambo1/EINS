"use client";

/**
 * Last-resort boundary: replaces the root layout when it throws, so it must
 * render its own <html>/<body> and must not depend on anything that can fail
 * (no globals.css, no @eins/ui, no fonts, no data). Inline styles only.
 * Production-only in Next; dev shows the error overlay instead.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
          background: "#ffffff",
          color: "#10101a",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>
          Das hat gerade nicht geklappt
        </h1>
        <p style={{ maxWidth: 440, margin: 0, color: "#4a4a57", lineHeight: 1.5 }}>
          Das Portal konnte nicht geladen werden. Bitte versuchen Sie es in
          einem Moment erneut. Bleibt das Problem bestehen, melden Sie sich bei
          uns und nennen Sie die Fehlernummer.
        </p>
        {error.digest && (
          <p style={{ margin: 0, fontSize: 14, color: "#4a4a57" }}>
            Fehlernummer: {error.digest}
          </p>
        )}
        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              font: "inherit",
              fontSize: 14,
              padding: 0,
              border: 0,
              background: "none",
              color: "#2f8f8a",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Erneut versuchen
          </button>
          {/* Plain <a>: a full reload is the point when the root layout broke. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ fontSize: 14, color: "#2f8f8a" }}>
            Zur Startseite
          </a>
        </div>
      </body>
    </html>
  );
}
