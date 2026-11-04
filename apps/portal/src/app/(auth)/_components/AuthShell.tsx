import type { CSSProperties, ReactNode } from "react";
import { cn } from "@eins/ui";
import { AUTH_FOCUS } from "./auth-ui";
import { AUTH_CARD, AUTH_COLUMN, AUTH_LEGAL, AUTH_LOGO_ROW, AUTH_MAIN } from "../_lib/sizes";

/**
 * Page frame for every sign-in screen, clinic (/login, /login/link,
 * /forgot-password, /set-password) and admin (/admin/login and friends):
 * the portal's grey canvas with one portal card on it, the EINS logo heading
 * the card. The card stands in the middle of the screen, phone and desktop
 * (Karam, 2026-11-03); its column keeps the height of the password step, so
 * the step from the address to the password grows the card downward and the
 * logo and title stay put. Datenschutz and Impressum follow right under the
 * card, out of the toast's way.
 *
 * Every light colour token is set again on the wrapper, the surfaces too
 * (--surface-tile and --well resolve at :root, so the dark theme's values
 * would come through otherwise). These pages stay light when someone saved
 * the dark theme on the admin host.
 *
 * Security notes (the frame also wraps the link pages, whose URL carries the
 * one-time token):
 * - Everything is first-party and static: local font, logo from /public. No
 *   third-party script, font, image or iframe.
 * - Clinic variant: the only external links go to the marketing site, with
 *   rel="noopener noreferrer" so the token URL never leaves as a Referer
 *   (next.config.ts sets no-referrer on the link pages as well).
 * - Admin variant: no external links at all. The admin host is internal
 *   (IP allowlist) and needs no way out to the marketing site.
 */

const MARKETING_ORIGIN = "https://eins.ag";

const LIGHT_TOKENS = {
  "--bg-primary": "#ffffff",
  "--bg-secondary": "#f5f5f7",
  "--bg-tertiary": "#ebebef",
  "--bg-card": "#fafafa",
  "--fg-primary": "#10101a",
  "--fg-secondary": "#4a4a52",
  "--fg-tertiary": "#6a6a74",
  "--accent-glow": "rgba(88, 186, 181, 0.3)",
  "--accent-soft": "rgba(88, 186, 181, 0.1)",
  "--border": "#e4e4e7",
  "--border-hover": "#d1d1d6",
  "--tone-good": "#19a36a",
  "--tone-good-bg": "rgba(25, 163, 106, 0.08)",
  "--tone-good-border": "rgba(25, 163, 106, 0.25)",
  "--tone-warn": "#d68902",
  "--tone-warn-bg": "rgba(214, 137, 2, 0.08)",
  "--tone-warn-border": "rgba(214, 137, 2, 0.28)",
  "--tone-bad": "#c9352b",
  "--tone-bad-bg": "rgba(201, 53, 43, 0.08)",
  "--tone-bad-border": "rgba(201, 53, 43, 0.25)",
  "--tone-neutral": "#4a4a52",
  "--tone-neutral-bg": "rgba(74, 74, 82, 0.05)",
  "--tone-neutral-border": "rgba(74, 74, 82, 0.15)",
  "--surface-canvas": "#f0f0f3",
  "--surface-tile": "#ffffff",
  "--surface-tile-hover": "#fafafa",
  "--surface-raised": "#ffffff",
  "--surface-inset": "#e6e6eb",
  "--hover-wash": "rgba(16, 16, 26, 0.05)",
  "--well": "color-mix(in srgb, #e6e6eb 45%, #ffffff)",
} as CSSProperties;

const LEGAL_LINK = cn(
  "inline-flex min-h-10 items-center rounded-[var(--r-small)] px-1 text-sm text-fg-tertiary transition-colors hover:text-fg-primary",
  AUTH_FOCUS
);

/**
 * Without JavaScript the streamed page stays in a hidden `<div id="S:0">`
 * after the skeleton for good (React swaps it in with a script). The link
 * button and the password form work without JavaScript, so then the page
 * shows and the skeleton goes (as on the Freigabe-Link).
 */
const NO_JS = `<style>div[hidden][id^="S:"]{display:block!important}[data-auth-skeleton]{display:none!important}</style>`;

/** A loading.tsx's frame: the same AuthShell, around the skeleton. */
export function AuthSkeletonShell({ children }: { children: ReactNode }) {
  return (
    <>
      <noscript dangerouslySetInnerHTML={{ __html: NO_JS }} />
      <div data-auth-skeleton>
        <AuthShell>{children}</AuthShell>
      </div>
    </>
  );
}

export function AuthShell({
  children,
  variant = "clinic",
}: {
  children: ReactNode;
  variant?: "clinic" | "admin";
}) {
  const admin = variant === "admin";
  return (
    <div
      data-auth-shell
      className="flex min-h-dvh flex-col bg-[var(--surface-canvas)] text-fg-primary [color-scheme:light]"
      style={LIGHT_TOKENS}
    >
      {/* The canvas behind overscroll too. Unmounts with the frame, so the
          portal keeps its own background after login. */}
      <style>{"html,body{background:#f0f0f3}"}</style>

      <main className={AUTH_MAIN}>
        <div className={AUTH_COLUMN}>
          <div data-auth-card className={AUTH_CARD}>
            <div className={AUTH_LOGO_ROW}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/eins-logo.svg" alt="EINS" width={1274} height={512} className="h-7 w-auto" />
              {admin && <span className="text-sm font-medium text-fg-secondary">Admin</span>}
            </div>
            {children}
          </div>
          {!admin && (
            <footer className={AUTH_LEGAL}>
              <nav aria-label="Rechtliches" className="flex gap-4">
                <a href={`${MARKETING_ORIGIN}/datenschutz`} target="_blank" rel="noopener noreferrer" className={LEGAL_LINK}>
                  Datenschutz
                </a>
                <a href={`${MARKETING_ORIGIN}/impressum`} target="_blank" rel="noopener noreferrer" className={LEGAL_LINK}>
                  Impressum
                </a>
              </nav>
            </footer>
          )}
        </div>
      </main>
    </div>
  );
}
