"use client";

import * as React from "react";
import type { Clinic, Treatment } from "@/lib/types";
import { telLink, whatsappLink } from "@/lib/format";

/**
 * Mobile sticky bottom action bar.
 *
 * - Mounts via `requestIdleCallback` so it never blocks LCP.
 * - Appears once the user scrolls past 200px.
 * - Hidden on tablet+ (md and up); on those sizes the top sticky nav is enough.
 */
export function StickyBottomCta({ clinic, treatment }: { clinic: Clinic; treatment: Treatment }) {
  const [mounted, setMounted] = React.useState(false);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const idle: typeof window.requestIdleCallback =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback
        : (((cb: IdleRequestCallback) =>
            window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 250)) as unknown as typeof window.requestIdleCallback);

    const handle = idle(() => setMounted(true));
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle as number);
      else window.clearTimeout(handle as unknown as number);
    };
  }, []);

  React.useEffect(() => {
    if (!mounted) return;
    const onScroll = () => setVisible(window.scrollY > 200);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mounted]);

  if (!mounted || !visible) return null;

  return (
    <div
      role="region"
      aria-label="Schnellzugriff Termin / Anrufen"
      className="sticky-bottom-cta fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-2 border-t border-brand-border bg-brand-bg px-3 pt-2 shadow-[0_-12px_32px_-16px_rgba(0,0,0,0.18)] md:hidden"
    >
      <a
        href="#anfrage"
        className="flex h-14 flex-col items-center justify-center rounded-brand bg-brand-primary text-brand-bg"
        data-cta="bottom-anfrage"
      >
        <span className="text-base font-semibold">Termin</span>
      </a>
      {clinic.contact.whatsappE164 ? (
        <a
          href={whatsappLink(
            clinic.contact.whatsappE164,
            `Hallo, ich interessiere mich für ${treatment.h1}.`,
          )}
          className="flex h-14 flex-col items-center justify-center rounded-brand border border-brand-border text-brand-fg"
          data-cta="bottom-whatsapp"
        >
          <span className="text-base font-semibold">WhatsApp</span>
        </a>
      ) : (
        <a
          href={`mailto:${clinic.contact.email}?subject=${encodeURIComponent("Anfrage " + treatment.h1)}`}
          className="flex h-14 flex-col items-center justify-center rounded-brand border border-brand-border text-brand-fg"
          data-cta="bottom-email"
        >
          <span className="text-base font-semibold">E-Mail</span>
        </a>
      )}
      <a
        href={telLink(clinic.contact.phoneE164)}
        className="flex h-14 flex-col items-center justify-center rounded-brand border border-brand-border text-brand-fg"
        data-cta="bottom-call"
      >
        <span className="text-base font-semibold">Anrufen</span>
      </a>
    </div>
  );
}
