"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, ChevronDown, LifeBuoy, Star } from "lucide-react";
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
        className="absolute inset-0 h-full w-full object-cover"
        priority
      />
    );
  }
  if (id === "rechtspruefung") {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-accent/50 bg-accent/10 sm:h-24 sm:w-24 md:h-32 md:w-32">
        <div className="flex flex-col items-center text-accent">
          <span className="font-mono text-[10px] font-bold tracking-tight leading-none sm:text-xs md:text-sm">
            HWG
          </span>
          <Check
            className="my-0.5 h-5 w-5 sm:h-6 sm:w-6 md:my-1 md:h-8 md:w-8"
            strokeWidth={3}
          />
          <span className="font-mono text-[10px] font-bold tracking-tight leading-none sm:text-xs md:text-sm">
            ZHG
          </span>
        </div>
      </div>
    );
  }
  if (id === "landingpages") {
    return (
      <div className="w-32 overflow-hidden rounded-md border border-border bg-bg-primary shadow-xl sm:w-40 md:w-52">
        <div className="flex items-center gap-1 border-b border-border bg-bg-secondary/60 px-2 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary/40" />
        </div>
        <div className="space-y-1.5 p-2.5 md:space-y-2 md:p-3">
          <div className="h-2.5 w-4/5 rounded bg-fg-primary/70 md:h-2 md:w-2/3 md:bg-fg-secondary/40" />
          <div className="h-1 w-full rounded bg-fg-secondary/30 md:h-1.5 md:bg-fg-secondary/20" />
          <div className="h-1 w-5/6 rounded bg-fg-secondary/30 md:h-1.5 md:bg-fg-secondary/20" />
          <div className="hidden md:mt-3 md:grid md:grid-cols-2 md:gap-1.5">
            <div className="md:h-1.5 md:rounded md:bg-fg-secondary/20" />
            <div className="md:h-1.5 md:rounded md:bg-fg-secondary/20" />
          </div>
          <div className="mt-2.5 h-5 w-3/5 rounded bg-accent md:mt-3 md:w-24" />
        </div>
      </div>
    );
  }
  if (id === "social-ads") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-3 md:gap-5">
        <Image
          src="/Facebook_Logo_(2019).png"
          alt="Facebook"
          width={120}
          height={120}
          className="h-9 w-9 object-contain sm:h-14 sm:w-14 md:h-20 md:w-20"
        />
        <Image
          src="/Instagram_icon.png"
          alt="Instagram"
          width={120}
          height={120}
          className="h-9 w-9 object-contain sm:h-14 sm:w-14 md:h-20 md:w-20"
        />
        <Image
          src="/tiktok-icon-free-png.webp"
          alt="TikTok"
          width={120}
          height={120}
          className="h-9 w-9 object-contain sm:h-14 sm:w-14 md:h-20 md:w-20"
        />
      </div>
    );
  }
  if (id === "ki-sortier") {
    return (
      <AiIcon className="aspect-[16/9] w-full max-w-[140px] sm:max-w-[200px] md:max-w-[280px]" />
    );
  }
  if (id === "reputation") {
    return (
      <div className="flex flex-col items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-0.5 sm:gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className="h-5 w-5 fill-yellow-400 text-yellow-400 sm:h-7 sm:w-7 md:h-9 md:w-9"
              strokeWidth={1.5}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
          <Image
            src="/Google_Favicon_2025.svg"
            alt="Google"
            width={20}
            height={20}
            className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6"
          />
          <span className="font-mono text-[10px] font-semibold tracking-wider text-fg-secondary sm:text-xs md:text-sm">
            ·
          </span>
          <Image
            src="/jameda-logo.png"
            alt="Jameda"
            width={2895}
            height={600}
            className="h-3 w-auto sm:h-4 md:h-5"
          />
        </div>
      </div>
    );
  }
  if (id === "begleitung") {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-accent/50 bg-accent/10 sm:h-24 sm:w-24 md:h-32 md:w-32">
        <LifeBuoy
          className="h-10 w-10 text-accent sm:h-12 sm:w-12 md:h-16 md:w-16"
          strokeWidth={1.75}
        />
      </div>
    );
  }
  return null;
}

function ExpandableCard({ card, index }: { card: OfferCard; index: number }) {
  const [open, setOpen] = useState(false);
  const isFullBleed = card.id === "medienproduktion";

  return (
    <Reveal delay={0.08 + index * 0.05}>
      <article className="card-glow group overflow-hidden rounded-2xl border border-border bg-transparent transition-colors duration-300 hover:border-accent/50">
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
              className="mt-4 hidden items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-bg-primary sm:mt-5 sm:px-4 sm:py-2 sm:text-sm md:inline-flex"
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
          <div className="order-2 flex w-36 shrink-0 flex-col sm:w-44 md:order-3 md:w-72 lg:w-80">
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
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-accent/60 bg-accent/15 px-3 py-1.5 font-mono text-xs font-semibold text-accent shadow-[0_0_0_1px_rgb(var(--accent)/0.15)] transition-colors hover:bg-accent hover:text-bg-primary sm:gap-1.5 sm:px-4 sm:py-2 sm:text-sm"
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
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 font-mono text-sm text-accent backdrop-blur-sm">
              <span className="inline-flex h-2 w-2 rounded-full bg-accent" aria-hidden />
              monatlich
            </span>
          </div>
          <h2 className="display-l mx-auto mt-4 max-w-6xl text-center">
            <ShimmerText className="block md:inline">Marketing</ShimmerText>{" "}
            <span className="block whitespace-nowrap md:inline">
              für Ihre Klinik.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 text-balance text-center font-display text-xl font-semibold tracking-tight text-fg-primary md:text-4xl">
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
