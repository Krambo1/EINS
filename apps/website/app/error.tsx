"use client";

import { ArrowUpRight } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { Button } from "@/components/ui/button";
import { CONTACT_EMAIL } from "@/lib/constants";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="container flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <div className="eyebrow">Fehler</div>
      <h1 className="display-m mt-6 max-w-2xl">Da ist etwas schiefgelaufen.</h1>
      <p className="mt-4 max-w-prose text-lg text-fg-primary">
        Bitte laden Sie die Seite neu. Besteht das Problem, schreiben Sie uns an{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline-offset-4 hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" size="lg" onClick={reset}>
          Erneut versuchen
        </Button>
        <ShinyButton href="/">
          Zur Startseite <ArrowUpRight className="h-4 w-4" />
        </ShinyButton>
      </div>
    </main>
  );
}
