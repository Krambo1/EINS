import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { authCardClass } from "./auth-ui";
import styles from "./auth.module.css";

/**
 * Page frame for every sign-in screen, clinic (/login, /login/link,
 * /forgot-password, /set-password) and admin (/admin/login and friends):
 * white page in the eins.ag look with the website hero's blurred mint
 * shapes, EINS logo top left, the form in one card.
 *
 * The light colour tokens are set again on the wrapper, so these pages stay
 * white even when someone switched the portal itself to dark.
 *
 * Security notes (the frame also wraps the link pages, whose URL carries the
 * one-time token):
 * - Everything is first-party and static: local font, logo from /public,
 *   icons inlined by lucide. No third-party script, font, image or iframe.
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
  "--border": "#e4e4e7",
  "--border-hover": "#d1d1d6",
  "--tone-good": "#19a36a",
  "--tone-bad": "#c9352b",
} as CSSProperties;

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
      className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-white text-fg-primary [color-scheme:light]"
      style={LIGHT_TOKENS}
    >
      {/* White behind overscroll too. Unmounts with the frame, so the portal
          keeps its own background after login. */}
      <style>{"html,body{background:#ffffff}"}</style>

      {/* The website hero's two blurred mint shapes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-2xl sm:-top-80 sm:blur-3xl"
      >
        <div
          className={`${styles.blob} relative left-[calc(50%-11rem)] w-[36.125rem] max-w-none -translate-x-1/2 rotate-[30deg] sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]`}
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-2xl sm:top-[calc(100%-30rem)] sm:blur-3xl"
      >
        <div
          className={`${styles.blob} relative left-[calc(50%+3rem)] w-[36.125rem] max-w-none -translate-x-1/2 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]`}
        />
      </div>

      <header className="flex items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <div className="flex h-10 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/eins-logo.svg" alt="EINS" width={1274} height={512} className="h-8 w-auto" />
          {admin && (
            <span className="rounded-full border border-border bg-white px-2.5 py-0.5 text-sm font-medium text-fg-primary">
              Admin
            </span>
          )}
        </div>
        {!admin && (
          <a
            href={MARKETING_ORIGIN}
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-base font-medium text-fg-primary transition-colors hover:text-[#3f938f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(88,186,181,0.4)]"
          >
            Zur Website
            <ArrowUpRight aria-hidden className="h-4 w-4" />
          </a>
        )}
      </header>

      <main className="flex flex-1 justify-center px-4 pb-12 pt-10 sm:items-center sm:pb-24 sm:pt-6">
        <div className="w-full max-w-[460px]">
          <div className={authCardClass}>{children}</div>
          {!admin && (
            <nav
              aria-label="Rechtliches"
              className="mt-8 flex justify-center gap-5 text-sm text-fg-secondary"
            >
              <a
                href={`${MARKETING_ORIGIN}/datenschutz`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 transition-colors hover:text-fg-primary hover:underline"
              >
                Datenschutz
              </a>
              <a
                href={`${MARKETING_ORIGIN}/impressum`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 transition-colors hover:text-fg-primary hover:underline"
              >
                Impressum
              </a>
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}
