import Link from "next/link";

/**
 * Tab nav shared between /auswertung (Übersicht) and /auswertung/forecast.
 * Server component — no client interactivity needed (real navigation per tab).
 */
export function AuswertungTabs({
  active,
}: {
  active: "overview" | "forecast";
}) {
  const tabs = [
    { key: "overview", label: "Übersicht", href: "/auswertung" },
    { key: "forecast", label: "Forecast", href: "/auswertung/forecast" },
  ] as const;
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Auswertungs-Tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-full border px-4 py-2 text-sm transition ${
            t.key === active
              ? "border-accent bg-accent/15 text-fg-primary"
              : "border-border text-fg-secondary hover:bg-bg-secondary"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
