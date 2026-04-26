"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@eins/ui";

export interface AdminNavLink {
  href: string;
  label: string;
}

export function AdminNav({ links }: { links: AdminNavLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Admin">
      {links.map((link) => {
        const active =
          link.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative rounded-full px-3 py-2 text-sm font-medium transition-colors duration-200",
              active
                ? "text-accent"
                : "text-fg-primary hover:text-accent"
            )}
          >
            {link.label}
            <span
              className={cn(
                "pointer-events-none absolute inset-x-3 -bottom-0.5 h-px origin-center bg-accent transition-transform duration-300 ease-expo",
                active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
