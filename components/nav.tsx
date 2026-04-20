"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { CALENDLY_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#system", label: "System" },
  { href: "/#ergebnisse", label: "Ergebnisse" },
  { href: "/#angebot", label: "Angebot" },
  { href: "/#faq", label: "FAQ" },
  { href: "/kontakt", label: "Kontakt" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  // Tracks whether either the hero CTA (#hero-cta) or the final CTA (#final-cta) is in view.
  // While one of them is visible → show the logo, hide the nav CTA.
  // When neither is visible (or neither exists on non-home pages) → show the nav CTA, hide the logo.
  const [pageCtaVisible, setPageCtaVisible] = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Observe the hero CTA and the final CTA. If neither exists (e.g. /kontakt), treat as "past hero".
  useEffect(() => {
    const ids = ["hero-cta", "final-cta"];
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) {
      setPageCtaVisible(false);
      return;
    }

    const visibility = new Map<Element, boolean>();
    elements.forEach((el) => visibility.set(el, false));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => visibility.set(entry.target, entry.isIntersecting));
        setPageCtaVisible(Array.from(visibility.values()).some(Boolean));
      },
      { threshold: 0 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Close on escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed left-0 right-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ease-expo",
          scrolled || open
            ? "border-b border-border bg-bg-primary/70 backdrop-blur-xl"
            : "border-b border-transparent"
        )}
      >
        <div className="container grid h-[72px] grid-cols-[1fr_auto_1fr] items-center">
          {/* Mobile burger (right) */}
          <button
            type="button"
            aria-label={open ? "Menü schließen" : "Menü öffnen"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="relative z-50 col-start-3 row-start-1 inline-flex h-12 w-12 items-center justify-center justify-self-end rounded-full border border-border bg-bg-primary/50 text-fg-primary transition-colors hover:border-accent/60 hover:text-accent md:hidden"
          >
            <span className="relative block h-5 w-5">
              <Menu
                className={cn(
                  "absolute inset-0 h-5 w-5 transition-all duration-200",
                  open ? "rotate-90 opacity-0" : "rotate-0 opacity-100"
                )}
              />
              <X
                className={cn(
                  "absolute inset-0 h-5 w-5 transition-all duration-200",
                  open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
                )}
              />
            </span>
          </button>

          {/* Logo: left on desktop and mobile (always visible on desktop);
             on mobile shares the left cell with the CTA and only shows while a page CTA is on-screen. */}
          <Link
            href="/"
            className={cn(
              "col-start-1 row-start-1 flex items-center justify-self-start pl-2 transition-opacity duration-300 md:pl-0 md:!pointer-events-auto md:!opacity-100",
              pageCtaVisible || open
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            )}
            aria-label="EINS Visuals"
            onClick={() => setOpen(false)}
          >
            <Image
              src="/eins-logo.png"
              alt="EINS Visuals"
              width={5311}
              height={2119}
              className="h-9 w-auto -translate-y-[2px] md:h-10"
              priority
            />
          </Link>

          {/* Desktop nav */}
          <nav
            className="hidden justify-self-center gap-8 md:flex"
            aria-label="Primary"
          >
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

          {/* CTA. On mobile shares the left grid cell with the logo; on desktop pinned right and always visible. */}
          <div
            className={cn(
              "col-start-1 row-start-1 justify-self-start transition-opacity duration-300 md:col-start-3 md:justify-self-end md:!pointer-events-auto md:!opacity-100",
              !pageCtaVisible || open
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            )}
          >
            <ShinyButton
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="!px-5 !py-3 !text-[0.9rem] md:!px-8 md:!py-4 md:!text-base"
            >
              <span className="whitespace-nowrap">Strategie-Gespräch buchen</span>
              <ArrowUpRight className="h-4 w-4" />
            </ShinyButton>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      <div
        id="mobile-menu"
        className={cn(
          "fixed inset-0 z-40 flex flex-col bg-bg-primary transition-opacity duration-300 ease-expo will-change-[opacity] md:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        aria-hidden={!open}
      >
        <div className="container flex flex-1 flex-col justify-between pb-12 pt-[96px]">
          <nav className="flex flex-col gap-2" aria-label="Mobile">
            {LINKS.map((l, i) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "group flex items-center justify-between border-b border-border py-5 font-display text-3xl font-medium tracking-tight text-fg-primary transition-[opacity,transform]",
                  open
                    ? "translate-y-0 opacity-100"
                    : "translate-y-4 opacity-0"
                )}
                style={{
                  transitionDelay: open ? `${80 + i * 50}ms` : "0ms",
                  transitionDuration: "400ms",
                }}
              >
                <span className="flex items-center gap-4">{l.label}</span>
                <ArrowUpRight className="h-5 w-5 text-fg-tertiary transition-colors group-hover:text-accent" />
              </a>
            ))}
          </nav>

          <div
            className={cn(
              "mt-10 transition-all",
              open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            )}
            style={{
              transitionDelay: open ? `${80 + LINKS.length * 50}ms` : "0ms",
              transitionDuration: "400ms",
            }}
          >
            <p className="text-center font-mono text-xs text-fg-tertiary">
              EINS Visuals, Premium Akquisitions-System
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
