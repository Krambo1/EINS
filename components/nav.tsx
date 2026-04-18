"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { CALENDLY_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#system", label: "System" },
  { href: "#ergebnisse", label: "Ergebnisse" },
  { href: "#angebot", label: "Angebot" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed left-0 right-0 top-0 z-50 transition-all duration-300 ease-expo",
        scrolled ? "border-b border-border bg-bg-primary/70 backdrop-blur-xl" : "border-b border-transparent"
      )}
    >
      <div className="container flex h-[72px] items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="EINS Visuals">
          <Image src="/eins-logo-new.png" alt="EINS Visuals" width={545} height={212} className="h-10 w-auto -translate-y-[2px]" priority />
        </Link>

        <nav className="hidden gap-8 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-fg-secondary transition-colors hover:text-fg-primary"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <ShinyButton
          href={CALENDLY_URL}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
        >
          Strategie-Call buchen <ArrowUpRight className="h-4 w-4" />
        </ShinyButton>
      </div>
    </header>
  );
}
