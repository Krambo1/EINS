import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import { DashCard, WASH_AREA, WASH_ROW } from "../../../dashboard/_components/dash-ui";
import { CardBody } from "../../_components/settings-ui";

/**
 * The three ways the Praxis-Software reaches the portal, one row each (the
 * vendor row's names from `PVS_VENDOR_LABELS`). Static, so the page and its
 * `loading.tsx` show the same card.
 */
const OPTIONS: Array<{ key: string; title: string; line: string; recommended?: boolean; href: string }> = [
  {
    key: "csv_upload",
    title: "CSV-Datei",
    line: "Funktioniert mit jeder Praxis-Software, die eine Tabelle ausgeben kann.",
    recommended: true,
    href: "/einstellungen/integrationen/setup/csv",
  },
  {
    key: "gdt_agent",
    title: "GDT-Agent",
    line: "Für Praxis-Software auf Ihren eigenen Rechnern (CGM, pixelmedic, x.concept usw.).",
    href: "/einstellungen/integrationen/setup/gdt-agent",
  },
  {
    key: "n8n_custom",
    title: "n8n-Ablauf",
    line: "Für jede andere Praxis-Software; Ihre IT übernimmt unsere Vorlage.",
    href: "/einstellungen/integrationen/setup/n8n",
  },
];

export function SetupOptions() {
  return (
    <DashCard bodyClassName="p-0 md:p-0">
      <CardBody className="pt-1 md:pb-5 md:pt-2">
        {/* Two lines per row: the grey keeps 12 px above and below them and
            4 px of white to the hairlines (DESIGN.md section 5). */}
        <ul className="divide-y divide-border">
          {OPTIONS.map((o) => (
            <li key={o.key} className={WASH_ROW}>
              <Link
                href={o.href}
                className={cn(
                  WASH_AREA,
                  "flex items-center gap-3 rounded-[var(--r-control)] py-3 transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-6 text-fg-primary">
                    {o.title}
                    {o.recommended && <span className="font-normal text-fg-secondary"> · Empfohlen</span>}
                  </span>
                  <span className="mt-0.5 block text-sm leading-5 text-fg-secondary">{o.line}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </DashCard>
  );
}
