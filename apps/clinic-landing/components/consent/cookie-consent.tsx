"use client";

import * as React from "react";
import Link from "next/link";
import {
  hasDecided,
  OPEN_CONSENT_EVENT,
  readConsent,
  writeConsent,
  type ConsentState,
} from "@/lib/consent";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  /** Used for the "Mehr Details" link to the clinic's datenschutz page. */
  privacyHref: string;
}

/**
 * Granular three-category cookie banner.
 * - Mounts ONLY after first paint to keep LCP free.
 * - Pre-decision: dialog visible, all non-essential off.
 * - Post-decision: button "Cookie-Einstellungen" in the footer reopens it.
 */
export function CookieConsent({ privacyHref }: Props) {
  const [hydrated, setHydrated] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [showDetails, setShowDetails] = React.useState(false);
  const [draft, setDraft] = React.useState<{ statistik: boolean; marketing: boolean }>({
    statistik: false,
    marketing: false,
  });
  const [current, setCurrent] = React.useState<ConsentState | null>(null);

  React.useEffect(() => {
    setHydrated(true);
    const c = readConsent();
    setCurrent(c);
    setDraft({ statistik: c.statistik, marketing: c.marketing });
    setOpen(!hasDecided(c));

    const onOpen = () => {
      const fresh = readConsent();
      setCurrent(fresh);
      setDraft({ statistik: fresh.statistik, marketing: fresh.marketing });
      setShowDetails(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, onOpen);
  }, []);

  if (!hydrated || !open) return null;

  const acceptAll = () => {
    writeConsent({ statistik: true, marketing: true });
    setOpen(false);
  };
  const acceptEssential = () => {
    writeConsent({ statistik: false, marketing: false });
    setOpen(false);
  };
  const saveSelection = () => {
    writeConsent(draft);
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      className="fixed inset-x-0 bottom-0 z-[80] p-3 md:inset-auto md:bottom-4 md:left-4 md:right-auto md:max-w-md"
    >
      <div className="rounded-brand-lg border border-brand-border bg-brand-bg p-4 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.18)] sm:p-5">
        <h2 id="consent-title" className="text-base font-semibold text-brand-fg">
          Cookies & Tracking
        </h2>
        <p className="mt-1 text-sm leading-snug text-brand-fg-muted">
          Wir nutzen technisch notwendige Cookies. Optional helfen uns Statistik-
          und Marketing-Pixel, diese Seite zu verbessern. Sie entscheiden.{" "}
          <Link
            href={privacyHref}
            className="underline underline-offset-4 hover:text-brand-primary"
          >
            Mehr in der Datenschutzerklärung
          </Link>
          .
        </p>

        {showDetails && (
          <div className="mt-4 space-y-2.5">
            <CategoryRow
              label="Notwendig"
              description="Funktional erforderlich. Nicht abwählbar."
              checked={true}
              disabled
              onChange={() => {}}
            />
            <CategoryRow
              label="Statistik"
              description="Anonyme Reichweitenmessung dieser Seite (first-party)."
              checked={draft.statistik}
              onChange={(v) => setDraft((d) => ({ ...d, statistik: v }))}
            />
            <CategoryRow
              label="Marketing"
              description="Werbenetzwerk-Pixel und Conversions API (Meta, Google, ggf. TikTok)."
              checked={draft.marketing}
              onChange={(v) => setDraft((d) => ({ ...d, marketing: v }))}
            />
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button variant="primary" onClick={acceptAll} fullWidth>
            Alle akzeptieren
          </Button>
          {!showDetails ? (
            <Button variant="secondary" onClick={acceptEssential} fullWidth>
              Nur notwendige
            </Button>
          ) : (
            <Button variant="secondary" onClick={saveSelection} fullWidth>
              Auswahl speichern
            </Button>
          )}
        </div>

        {!showDetails && (
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="mt-3 w-full text-sm text-brand-fg-muted underline underline-offset-4 hover:text-brand-fg"
          >
            Einzeln auswählen
          </button>
        )}
        {/* No-op once decision is made; provider will still react via the event */}
        <span className="sr-only">Aktueller Stand: {current?.decidedAt ?? "noch keine Entscheidung"}</span>
      </div>
    </div>
  );
}

function CategoryRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-start justify-between gap-3 rounded-brand border border-brand-border bg-brand-bg p-3",
        disabled && "opacity-70",
      )}
    >
      <div>
        <div className="text-sm font-medium text-brand-fg">{label}</div>
        <div className="text-xs text-brand-fg-muted">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 flex-none accent-brand-primary"
        aria-label={label}
      />
    </label>
  );
}

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}
      className={cn(
        "text-sm text-brand-fg-muted underline-offset-4 hover:text-brand-fg hover:underline",
        className,
      )}
    >
      Cookie-Einstellungen
    </button>
  );
}
