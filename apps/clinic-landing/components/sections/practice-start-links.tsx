"use client";

import * as React from "react";
import { withAttribution } from "@/lib/attribution";

export interface PracticeStartItem {
  urlCode: string;
  label: string;
}

interface Props {
  clinicSlug: string;
  items: PracticeStartItem[];
}

/**
 * Treatment choice on the practice start page. Each link points at the
 * treatment page's neutral urlCode address and carries every utm_* and click
 * id of this visit (captured by the inline attribution script before it
 * cleaned the address), so the treatment page captures them again.
 *
 * Server render: `/<clinicSlug>/<urlCode>` without parameters, which works on
 * every host. After hydration: the same base as the current address (`""` on
 * the practice domain, `/<clinicSlug>` on internal hosts) plus the parameters.
 * Plain <a>, not next/link: a full page load runs the treatment page's
 * attribution script again.
 */
export function PracticeStartLinks({ clinicSlug, items }: Props) {
  const [hrefFor, setHrefFor] = React.useState<(code: string) => string>(
    () => (code: string) => `/${clinicSlug}/${code}`,
  );

  React.useEffect(() => {
    const path = window.location.pathname;
    const base = path === `/${clinicSlug}` || path.startsWith(`/${clinicSlug}/`) ? `/${clinicSlug}` : "";
    const attribution = window.__einsAttribution__;
    setHrefFor(() => (code: string) => withAttribution(`${base}/${code}`, attribution));
  }, [clinicSlug]);

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.urlCode}>
          <a
            href={hrefFor(item.urlCode)}
            className="flex min-h-[64px] items-center justify-between gap-4 rounded-brand border border-brand-border bg-brand-bg px-5 py-4 text-base font-medium text-brand-fg transition-colors hover:border-brand-primary hover:text-brand-primary"
          >
            <span>{item.label}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
