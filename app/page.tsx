import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { ScrollProgress } from "@/components/scroll-progress";
import { Hero } from "@/components/sections/hero";
import { StatsShowcase } from "@/components/sections/stats-showcase";
import { System } from "@/components/sections/system";
import { Offer } from "@/components/sections/offer";
import { Roi } from "@/components/sections/roi";
import { Guarantee } from "@/components/sections/guarantee";
import { Timeline } from "@/components/sections/timeline";
import { FitCheck } from "@/components/sections/fit-check";
import { Objections } from "@/components/sections/objections";
import { FinalCta } from "@/components/sections/final-cta";

export default function Page() {
  return (
    <>
      <ScrollProgress />
      <Nav />
      <main>
        <Hero />
        <System />
        <Roi />
        <Offer />
        <StatsShowcase />
        <Guarantee />
        <Timeline />
        <FitCheck />
        <Objections />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
