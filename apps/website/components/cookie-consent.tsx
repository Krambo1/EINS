"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";

const STORAGE_KEY = "eins-consent-v1";
const OPEN_EVENT = "eins:open-consent";

type Decision = "all" | "essential" | null;

function readStoredDecision(): Decision {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "all" || value === "essential") return value;
  } catch {
    // ignore (private mode, blocked storage)
  }
  return null;
}

function persistDecision(decision: Exclude<Decision, null>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, decision);
  } catch {
    // ignore
  }
}

export function openCookieSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CookieConsent() {
  const [mounted, setMounted] = useState(false);
  const [decision, setDecision] = useState<Decision>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = readStoredDecision();
    setDecision(stored);
    setOpen(stored === null);

    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const choose = (value: Exclude<Decision, null>) => {
    persistDecision(value);
    setDecision(value);
    setOpen(false);
  };

  if (!mounted) return null;

  const consentGranted = decision === "all";

  return (
    <>
      {consentGranted && <ConsentGatedThirdParties />}

      {open && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="Cookie-Hinweis"
          className="fixed inset-x-3 bottom-3 z-[90] md:inset-auto md:bottom-4 md:left-4 md:max-w-xs"
        >
          <div className="rounded-xl border border-border bg-bg-primary/95 p-3 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.6)] backdrop-blur-md">
            <p className="text-[12px] leading-snug text-fg-primary">
              Wir laden Vercel Analytics und Calendly nur mit Ihrer
              Einwilligung.{" "}
              <Link
                href="/datenschutz"
                className="text-fg-secondary underline-offset-4 hover:text-fg-primary hover:underline"
              >
                Datenschutz
              </Link>
              {" · "}
              <Link
                href="/impressum"
                className="text-fg-secondary underline-offset-4 hover:text-fg-primary hover:underline"
              >
                Impressum
              </Link>
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => choose("all")}
                className="inline-flex h-7 flex-1 items-center justify-center rounded-full bg-accent px-3 text-[11px] font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary"
              >
                Akzeptieren
              </button>
              <button
                type="button"
                onClick={() => choose("essential")}
                className="inline-flex h-7 flex-1 items-center justify-center rounded-full border border-border bg-transparent px-3 text-[11px] font-medium text-fg-primary transition-colors hover:border-border-hover hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary"
              >
                Ablehnen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConsentGatedThirdParties() {
  useEffect(() => {
    const PRECONNECT_ID = "calendly-preconnect";
    const DNS_ID = "calendly-dns-prefetch";
    if (!document.getElementById(PRECONNECT_ID)) {
      const a = document.createElement("link");
      a.id = PRECONNECT_ID;
      a.rel = "preconnect";
      a.href = "https://calendly.com";
      document.head.appendChild(a);
    }
    if (!document.getElementById(DNS_ID)) {
      const b = document.createElement("link");
      b.id = DNS_ID;
      b.rel = "dns-prefetch";
      b.href = "https://calendly.com";
      document.head.appendChild(b);
    }
  }, []);

  return (
    <>
      <Analytics />
    </>
  );
}

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCookieSettings}
      className={className}
    >
      Cookie-Einstellungen
    </button>
  );
}
