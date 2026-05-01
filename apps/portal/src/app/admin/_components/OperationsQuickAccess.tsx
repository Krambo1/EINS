import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@eins/ui";
import type { PendingOperations } from "@/server/queries/admin";

const ITEMS: {
  href: string;
  label: string;
  key: keyof PendingOperations;
  tone: "bad" | "warn" | "neutral";
}[] = [
  { href: "/admin/operations#sla", label: "SLA-Verstöße", key: "slaBreaches", tone: "bad" },
  { href: "/admin/operations#upgrades", label: "Upgrade-Anfragen", key: "openUpgrades", tone: "warn" },
  { href: "/admin/operations#animationen", label: "Animationen offen", key: "animationsRequested", tone: "warn" },
  { href: "/admin/operations#sync-fehler", label: "Sync-Fehler", key: "syncErrors", tone: "bad" },
  { href: "/admin/operations#mfa", label: "MFA fehlt", key: "mfaMissing", tone: "warn" },
  { href: "/admin/operations#stagnierte", label: "Stagnierte Leads", key: "stalledRequests", tone: "warn" },
];

export function OperationsQuickAccess({ data }: { data: PendingOperations }) {
  return (
    <section className="card-glow rounded-2xl border border-border bg-bg-secondary/60 p-6 backdrop-blur-sm md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
            Operations
          </span>
          <h2 className="mt-1 font-display text-xl font-semibold">
            Was wartet auf mich?
          </h2>
        </div>
        <Link
          href="/admin/operations"
          className="text-sm text-accent hover:underline"
        >
          Alle Aufgaben →
        </Link>
      </header>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((item) => {
          const count = data[item.key];
          const tone = count > 0 ? item.tone : "neutral";
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-primary/60 px-4 py-3 text-sm font-medium text-fg-primary transition-colors hover:border-accent/60"
            >
              <span className="flex items-center gap-2">
                {item.label}
                {count > 0 && <Badge tone={tone}>{count}</Badge>}
              </span>
              <ArrowUpRight className="h-4 w-4 text-fg-tertiary transition-colors group-hover:text-accent" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
