"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, ChevronDown, Star } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { AiIcon } from "@/components/ui/lottie-icon";
import { OFFER_CARDS, type OfferCard } from "@/lib/system-data";

// Per-card visual rendering. The camera card fills its area edge-to-edge
// (object-cover); icon cards center their visual with breathing room.
function CardVisual({ id }: { id: OfferCard["id"] }) {
  if (id === "medienproduktion") {
    return (
      <Image
        src="/top-view-hands-with-photo-camera.png"
        alt=""
        width={1080}
        height={737}
        sizes="(max-width: 768px) 144px, 320px"
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />
    );
  }
  if (id === "rechtspruefung") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="rp-icon-loop h-24 w-24 translate-y-1.5 text-fg-primary sm:h-24 sm:w-24 sm:translate-y-1 md:h-32 md:w-32 md:translate-y-0"
      >
        <path d="M4 4h9l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <polyline points="13 4 13 8 17 8" />
        <line x1="6" y1="11" x2="14" y2="11" />
        <line x1="6" y1="13.5" x2="11" y2="13.5" />
        <circle
          className="rp-stamp-ring"
          cx="17"
          cy="17"
          r="5"
          fill="none"
          stroke="#58BAB5"
          strokeWidth={0.5}
        />
        <g className="rp-stamp">
          <g transform="rotate(-12 17 17)">
            <rect x="13.5" y="14" width="7" height="6" rx="1" fill="#FFFFFF" stroke="#58BAB5" />
            <text
              x="17"
              y="18.7"
              fontSize="5.5"
              fontWeight="700"
              fill="#58BAB5"
              stroke="none"
              textAnchor="middle"
            >
              §
            </text>
          </g>
        </g>
      </svg>
    );
  }
  if (id === "landingpages") {
    return (
      <svg
        viewBox="0 0 240 180"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="lp-icon-loop w-32 translate-y-1 text-fg-primary sm:w-40 sm:translate-y-1 md:w-52 md:translate-y-0"
      >
        <rect x="20" y="20" width="200" height="140" rx="6" />
        <line x1="20" y1="42" x2="220" y2="42" />
        <circle cx="32" cy="31" r="2.4" fill="currentColor" stroke="none" />
        <circle cx="40" cy="31" r="2.4" fill="currentColor" stroke="none" />
        <circle cx="48" cy="31" r="2.4" fill="currentColor" stroke="none" />
        <rect x="62" y="25" width="148" height="12" rx="3" />
        <text
          x="70"
          y="34.4"
          fontSize="9"
          fontWeight="700"
          fill="currentColor"
          stroke="none"
        >
          www.
        </text>
        <line x1="36" y1="68" x2="180" y2="68" strokeWidth={3.2} />
        <line x1="36" y1="84" x2="148" y2="84" strokeWidth={3.2} />
        <line x1="36" y1="98" x2="128" y2="98" strokeWidth={2} />
        <rect
          className="lp-button-ripple"
          x="36"
          y="118"
          width="92"
          height="22"
          rx="11"
          fill="none"
          stroke="#58BAB5"
          strokeWidth={2}
        />
        <rect
          className="lp-button"
          x="36"
          y="118"
          width="92"
          height="22"
          rx="11"
          fill="#58BAB5"
          stroke="#58BAB5"
        />
        <path
          className="lp-cursor"
          d="M118 130 L138 144 L128.6 146.5 L133.6 156.4 L128 158.6 L123 148.6 L116 152.6 Z"
          fill="currentColor"
          stroke="#ffffff"
          strokeWidth={1.4}
        />
      </svg>
    );
  }
  if (id === "social-ads") {
    return (
      <div className="flex translate-y-1.5 flex-wrap items-center justify-center gap-1.5 sm:translate-y-1 sm:gap-3 md:translate-y-0 md:gap-5">
        <Image
          src="/Facebook_Logo_(2019).png"
          alt="Facebook"
          width={120}
          height={120}
          className="h-10 w-10 object-contain sm:h-14 sm:w-14 md:h-20 md:w-20"
        />
        <Image
          src="/Instagram_icon.png"
          alt="Instagram"
          width={120}
          height={120}
          className="h-10 w-10 object-contain sm:h-14 sm:w-14 md:h-20 md:w-20"
        />
        <Image
          src="/tiktok-icon-free-png.webp"
          alt="TikTok"
          width={120}
          height={120}
          className="h-10 w-10 object-contain sm:h-14 sm:w-14 md:h-20 md:w-20"
        />
      </div>
    );
  }
  if (id === "ki-sortier") {
    return (
      <AiIcon className="aspect-[16/9] w-full max-w-[140px] translate-y-1.5 sm:max-w-[200px] sm:translate-y-1 md:max-w-[280px] md:translate-y-0" />
    );
  }
  if (id === "reputation") {
    return (
      <div className="rep-icon-loop flex translate-y-1.5 flex-col items-center gap-2 sm:translate-y-1 sm:gap-3 md:translate-y-0">
        <div className="flex items-center gap-0.5 sm:gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className="rep-star h-6 w-6 fill-yellow-400 text-yellow-400 sm:h-7 sm:w-7 md:h-9 md:w-9"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
          <Image
            src="/Google_Favicon_2025.svg"
            alt="Google"
            width={20}
            height={20}
            className="h-5 w-5 sm:h-5 sm:w-5 md:h-6 md:w-6"
          />
          <span className="font-mono text-[10px] font-semibold tracking-wider text-fg-secondary sm:text-xs md:text-sm">
            ·
          </span>
          <Image
            src="/jameda-logo.png"
            alt="Jameda"
            width={2895}
            height={600}
            className="h-4 w-auto sm:h-4 md:h-5"
          />
        </div>
      </div>
    );
  }
  if (id === "begleitung") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="cp-icon-loop h-24 w-24 translate-y-1.5 text-fg-primary sm:h-24 sm:w-24 sm:translate-y-1 md:h-32 md:w-32 md:translate-y-0"
      >
        <circle cx="12" cy="12" r="8.5" />
        <line x1="12" y1="3.5" x2="12" y2="4.6" />
        <line x1="12" y1="19.4" x2="12" y2="20.5" />
        <line x1="3.5" y1="12" x2="4.6" y2="12" />
        <line x1="19.4" y1="12" x2="20.5" y2="12" />
        <g className="cp-needle">
          <path d="M12 7.4 L13.55 12 L10.45 12 Z" fill="#58BAB5" stroke="#58BAB5" />
          <path d="M12 16.6 L13.55 12 L10.45 12 Z" fill="currentColor" stroke="currentColor" />
        </g>
        <circle cx="12" cy="12" r="0.9" fill="#fff" stroke="currentColor" />
      </svg>
    );
  }
  return null;
}

function ExpandableCard({ card, index }: { card: OfferCard; index: number }) {
  const [open, setOpen] = useState(false);
  const isFullBleed = card.id === "medienproduktion";

  return (
    <Reveal delay={0.08 + index * 0.05}>
      <article className="card-glow group overflow-hidden rounded-3xl border border-border bg-transparent transition-colors duration-300 hover:border-accent/50">
        <div className="flex flex-row md:items-stretch">
          <div className="order-1 flex-1 min-w-0 pl-4 pr-1 pb-3 pt-4 sm:pl-6 sm:pr-2 sm:pb-4 sm:pt-6 md:order-2 md:flex-1 md:p-10">
            <h3
              className="font-display text-lg font-semibold tracking-tight hyphens-auto break-words sm:text-2xl md:text-4xl"
              lang="de"
            >
              {card.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-primary sm:mt-3 sm:text-base md:mt-4 md:text-lg">
              {card.teaser}
            </p>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`card-${card.id}-details`}
              onClick={() => setOpen((v) => !v)}
              className="mt-4 hidden items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-bg-primary hover:[text-shadow:none] sm:mt-5 sm:px-4 sm:py-2 sm:text-sm md:inline-flex"
            >
              {open ? "Weniger anzeigen" : "Mehr erfahren"}
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-300 ${
                  open ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>
          </div>
          <div
            className={`order-2 flex w-36 shrink-0 flex-col sm:w-44 md:order-3 md:w-72 lg:w-80 ${
              isFullBleed ? "" : "pt-5 sm:pt-6 md:pt-0"
            }`}
          >
            <div
              className={`relative flex h-28 w-full items-center justify-center overflow-hidden sm:h-32 md:h-auto md:flex-1 ${
                isFullBleed ? "" : "px-1.5 py-2 sm:px-3 sm:py-3 md:px-8 md:py-8"
              }`}
            >
              <CardVisual id={card.id} />
            </div>
            <div className="flex justify-end px-2 pb-3 pt-5 sm:px-3 sm:pb-4 sm:pt-6 md:hidden">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`card-${card.id}-details`}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-accent/60 bg-accent/15 px-3 py-1.5 font-mono text-xs font-semibold text-accent shadow-[0_0_0_1px_rgb(var(--accent)/0.15)] transition-colors hover:bg-accent hover:text-bg-primary hover:[text-shadow:none] sm:gap-1.5 sm:px-4 sm:py-2 sm:text-sm"
              >
                {open ? "Weniger anzeigen" : "Mehr erfahren"}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-300 sm:h-4 sm:w-4 ${
                    open ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
              </button>
            </div>
          </div>
        </div>
        {open && (
          <div
            id={`card-${card.id}-details`}
            className="animate-fade-slide-in px-4 pb-4 sm:px-6 sm:pb-6 md:px-10 md:pb-10"
          >
            <ul className="space-y-3 border-t border-border pt-5 text-sm leading-relaxed text-fg-primary sm:pt-6 sm:text-base md:text-lg">
              {card.bullets.map((b) => (
                <li key={b} className="flex gap-3">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-accent md:h-5 md:w-5" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>
    </Reveal>
  );
}

export function System() {
  return (
    <section id="system" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <div className="flex justify-center">
            <span className="eyebrow">monatlich</span>
          </div>
          <h2 className="display-l mx-auto mt-4 max-w-6xl text-center">
            <span className="block md:inline">Das EINS-</span>
            <ShimmerText className="block md:inline">Wachstumssystem.</ShimmerText>
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 text-balance text-center font-display text-base font-semibold tracking-tight text-fg-primary sm:text-xl md:text-4xl">
            Werden Sie zur&nbsp;EINS in Ihrer Region.
          </p>
        </Reveal>

        <div className="mx-auto mt-10 max-w-5xl space-y-5 md:mt-16 md:space-y-6">
          {OFFER_CARDS.map((card, i) => (
            <ExpandableCard key={card.id} card={card} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
