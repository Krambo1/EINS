"use client";

import { ParamLink, useParamViews } from "@/app/_components/instant-views";

interface Item {
  key: string;
  label: string;
}

/**
 * The tabs of /admin/audit. Inside the page's ParamViews a tap switches to
 * the kept view at once and only rewrites `?tab=` (filter state resets, as
 * before); a new-tab click stays a normal link.
 */
export function AuditTabsNav({ tabs }: { tabs: Item[] }) {
  return (
    <nav className="flex items-center gap-1" aria-label="Audit">
      {tabs.map((t) => (
        <ParamLink
          key={t.key}
          param="tab"
          value={t.key}
          href={t.key === "uebersicht" ? "/admin/audit" : `/admin/audit?tab=${t.key}`}
          className="group relative rounded-full px-3 py-2 text-sm font-medium transition-colors duration-200"
          activeClassName="text-accent"
          inactiveClassName="text-fg-primary hover:text-accent"
        >
          {t.label}
          <TabMark param="tab" value={t.key} />
        </ParamLink>
      ))}
    </nav>
  );
}

function TabMark({ param, value }: { param: string; value: string }) {
  const views = useParamViews(param);
  if (views?.picked !== value) return null;
  return <span className="pointer-events-none absolute inset-x-3 -bottom-0.5 h-px bg-accent" />;
}
