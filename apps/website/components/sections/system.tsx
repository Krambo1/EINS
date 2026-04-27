import Image from "next/image";
import { Reveal } from "@/components/ui/reveal";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { AiIcon } from "@/components/ui/lottie-icon";
import { LAYERS } from "@/lib/system-data";
import { md } from "@/lib/md";

export function System() {
  return (
    <section id="system" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            <ShimmerText className="block md:inline">Marketing</ShimmerText>{" "}
            <span className="block whitespace-nowrap md:inline">für Ihre Klinik.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 text-balance text-center font-display text-2xl font-semibold tracking-tight text-fg-primary md:text-5xl">
            Werden Sie zur&nbsp;EINS in Ihrer Region.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-6 md:mt-16 md:grid-cols-3">
          {LAYERS.map((layer, i) => {
            return (
            <Reveal key={layer.number} delay={0.1 + i * 0.1}>
              <article className="card-glow group relative h-full rounded-2xl border border-border bg-bg-primary p-6 md:p-10 transition-all duration-300 ease-expo hover:border-accent/50">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                {i === 0 && (
                  <div className="-ml-6 -mt-3 -mb-6 md:-ml-10 md:-mt-5 md:-mb-8 flex justify-start">
                    <Image
                      src="/top-view-hands-with-photo-camera.png"
                      alt=""
                      width={1080}
                      height={737}
                      className="h-auto w-56 md:w-64 -scale-x-100"
                      priority
                    />
                  </div>
                )}
                {i === 1 && (
                  <div className="flex items-center justify-center gap-5 md:gap-6">
                    <Image
                      src="/Facebook_Logo_(2019).png"
                      alt="Facebook"
                      width={120}
                      height={120}
                      className="h-20 w-20 md:h-24 md:w-24 object-contain"
                    />
                    <Image
                      src="/Instagram_icon.png"
                      alt="Instagram"
                      width={120}
                      height={120}
                      className="h-20 w-20 md:h-24 md:w-24 object-contain"
                    />
                    <Image
                      src="/tiktok-icon-free-png.webp"
                      alt="TikTok"
                      width={120}
                      height={120}
                      className="h-20 w-20 md:h-24 md:w-24 object-contain"
                    />
                  </div>
                )}
                {i === 2 && (
                  <div className="flex items-start overflow-hidden">
                    <AiIcon className="h-44 w-44 md:h-56 md:w-56 -m-12 md:-m-16 translate-x-2 md:translate-x-3" />
                  </div>
                )}
                <h3 className="mt-8 font-display text-4xl font-semibold tracking-tight md:text-5xl">{layer.title}</h3>
                <ul className="mt-6 space-y-4 text-lg leading-relaxed text-fg-primary md:text-xl">
                  {layer.bullets.map((b) => (
                    <li key={b} className="flex gap-3">
                      <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span>{md(b)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
