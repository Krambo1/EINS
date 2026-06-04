"use client";

import { cn } from "@eins/ui";

/**
 * "Mit Google anmelden" button used on both the clinic (/login) and admin
 * (/admin/login) login forms.
 *
 * Renders a plain <a> (NOT next/link) on purpose: the href is a server route
 * that 302-redirects to Google, which is a full-document navigation, not a
 * client-side route transition. Each call site passes a `className` so the
 * button matches that form's own sizing (cn = tailwind-merge, so overrides for
 * rounding / padding / text size / bg win cleanly).
 */
export function GoogleSignInButton({
  href,
  className,
  label = "Mit Google anmelden",
}: {
  href: string;
  className?: string;
  label?: string;
}) {
  return (
    <a
      href={href}
      className={cn(
        "flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-bg-primary px-4 py-3 text-sm font-medium text-fg-primary transition hover:bg-bg-secondary",
        className
      )}
    >
      <GoogleGlyph />
      {label}
    </a>
  );
}

/** Official Google "G" mark (4-color). Inline so it ships no extra request. */
function GoogleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}
