"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { formatNumber } from "@/lib/formatting";
import { CONTROL, CONTROL_SQUARE, RAISED_CONTROL } from "../../../dashboard/_components/dash-ui";

const STEP = cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE);

/**
 * "3 von 12" and the way to the neighbouring Rückmeldungen of the list the
 * person came from (Gmail's and Zendesk's arrows in the record's header),
 * also on the arrow keys left and right while no field has the focus
 * (Linear, Help Scout). Both buttons always stand there; at either end one
 * is greyed, so neither moves.
 */
export function FeedbackNav({
  position,
  total,
  prevHref,
  nextHref,
}: {
  /** 1-based place in the list, null when the entry is not in it. */
  position: number | null;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (t?.closest("[role=menu],[role=dialog],[role=radiogroup]")) return;
      const href = e.key === "ArrowLeft" ? prevHref : e.key === "ArrowRight" ? nextHref : null;
      if (!href) return;
      e.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevHref, nextHref, router]);

  return (
    <div className="flex items-center gap-2">
      {position != null && (
        <span className="mr-1 text-sm tabular-nums text-fg-secondary">
          {formatNumber(position)} von {formatNumber(total)}
        </span>
      )}
      <Step href={prevHref} label="Vorherige Rückmeldung" hint="Pfeiltaste links">
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Step>
      <Step href={nextHref} label="Nächste Rückmeldung" hint="Pfeiltaste rechts">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Step>
    </div>
  );
}

function Step({
  href,
  label,
  hint,
  children,
}: {
  href: string | null;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <Button variant="outline" disabled aria-label={label} className={STEP}>
        {children}
      </Button>
    );
  }
  // The neighbouring Rückmeldung is fetched whole ahead, so the arrow (and
  // its key) opens it at once (production only; dev never prefetches).
  return (
    <Button asChild variant="outline" className={STEP}>
      <Link href={href} prefetch aria-label={label} title={`${label} (${hint})`}>
        {children}
      </Link>
    </Button>
  );
}
