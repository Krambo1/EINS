"use client";

/**
 * Last-resort boundary: replaces the root layout when it throws, so it must
 * render its own <html>/<body> and must not depend on anything that can fail
 * (no globals.css, no @eins/ui, no fonts, no data). Inline styles only.
 * Production-only in Next; dev shows the error overlay instead.
 *
 * Laid out like `error.tsx` from the portal's values, copied by hand: the
 * canvas (#f0f0f3), one white card (radius 20, the card shadow) in the
 * width of the Freigabe frame, the way home as a plain link, the retry as
 * the dark button.
 *
 * The retry reloads the page instead of calling the `reset` Next passes:
 * `reset()` only re-renders in the browser, which never brings back a root
 * layout that threw, while a reload asks the server for the page again.
 */
export default function GlobalError({
  error,
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
          padding: "48px 16px 32px",
          boxSizing: "border-box",
          background: "#f0f0f3",
          color: "#10101a",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: 576,
            margin: "0 auto",
            background: "#ffffff",
            borderRadius: 20,
            boxShadow:
              "0 0 0 1px rgba(16,16,26,0.06), 0 1px 2px rgba(16,16,26,0.05), 0 4px 10px -4px rgba(16,16,26,0.06)",
          }}
        >
          <div style={{ padding: "20px 20px 20px" }}>
            <h1 style={{ fontSize: 20, lineHeight: "28px", fontWeight: 600, margin: 0 }}>
              Das hat gerade nicht geklappt
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 15, lineHeight: "24px" }}>
              Das Portal konnte nicht geladen werden. Bleibt der Fehler, schreiben
              Sie uns die Fehlernummer.
            </p>
            {/* The row stays when an error has no number, so the card keeps its height. */}
            <p style={{ margin: "8px 0 0", minHeight: 20, fontSize: 14, lineHeight: "20px", color: "#4a4a52" }}>
              {error.digest && (
                <>
                  Fehlernummer: <span style={{ color: "#10101a", userSelect: "all" }}>{error.digest}</span>
                </>
              )}
            </p>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "16px 20px",
              borderTop: "1px solid #e4e4e7",
            }}
          >
            {/* Plain <a>: a full reload is the point when the root layout broke. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{ fontSize: 14, fontWeight: 500, color: "#10101a", textDecoration: "underline", textUnderlineOffset: 4 }}
            >
              Zur Startseite
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                font: "inherit",
                fontSize: 15,
                fontWeight: 500,
                height: 40,
                padding: "0 16px",
                border: 0,
                borderRadius: 8,
                background: "#10101a",
                color: "#ffffff",
                cursor: "pointer",
              }}
            >
              Erneut versuchen
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
