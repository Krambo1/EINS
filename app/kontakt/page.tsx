import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Mail, Calendar, Phone } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { CALENDLY_URL, CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/constants";

export const metadata = { title: "Kontakt · EINS Visuals" };

export default function Kontakt() {
  return (
    <main className="container flex min-h-screen flex-col justify-center py-24">
      <Link
        href="/"
        className="mb-12 inline-flex items-center gap-2 font-mono text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Zurück
      </Link>

      <div>
        <div className="max-w-3xl">
          <div className="eyebrow">Kontakt</div>
          <h1 className="display-l mt-6">
            Lassen Sie uns{" "}
            <span className="text-accent-gradient">sprechen.</span>
          </h1>
          <p className="mt-6 max-w-prose text-lg text-fg-secondary">
            Sie haben Fragen zum System, zur Zusammenarbeit oder wollen direkt einen
            Strategie-Gespräch vereinbaren. Wählen Sie den Weg, der für Sie am besten passt.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {/* Strategie-Gespräch */}
          <div className="card-glow relative h-full overflow-hidden rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/[0.06] to-white/[0.015] p-8 backdrop-blur-sm">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
              style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
            />
            <Calendar className="h-6 w-6 text-accent" />
            <div className="mt-6 font-mono text-base text-accent">
              Strategie-Gespräch
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-medium leading-tight tracking-tight mt-3">30 Minuten, kostenlos.</h2>
            <p className="mt-4 text-fg-secondary">
              Wir analysieren Ihre aktuelle Akquise-Situation und zeigen Ihnen, ob und
              wie das EINS-System für Ihre Klinik funktioniert.
            </p>
            <div className="mt-8">
              <ShinyButton href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
                Termin auswählen <ArrowUpRight className="h-4 w-4" />
              </ShinyButton>
            </div>
          </div>

          {/* E-Mail */}
          <div className="card-glow h-full rounded-3xl border border-border bg-white/[0.015] p-8 backdrop-blur-sm">
            <Mail className="h-6 w-6 text-fg-primary" />
            <div className="mt-6 font-mono text-base text-fg-secondary">
              E-Mail
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-medium leading-tight tracking-tight mt-3">Schreiben Sie uns.</h2>
            <p className="mt-4 text-fg-secondary">
              Für Fragen, die kein Gespräch brauchen. Wir antworten in der Regel innerhalb
              eines Werktages.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-8 inline-flex items-center gap-2 font-display text-lg text-accent underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL} <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>

          {/* Telefon */}
          <div className="card-glow h-full rounded-3xl border border-border bg-white/[0.015] p-8 backdrop-blur-sm">
            <Phone className="h-6 w-6 text-fg-primary" />
            <div className="mt-6 font-mono text-base text-fg-secondary">
              Telefon
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-medium leading-tight tracking-tight mt-3">Rufen Sie an.</h2>
            <p className="mt-4 text-fg-secondary">
              Direkt, ohne Umwege. Erreichbar Montag bis Freitag von 9 bis 18 Uhr.
            </p>
            <a
              href={`tel:${CONTACT_PHONE.replace(/\s/g, "")}`}
              className="mt-8 inline-flex items-center gap-2 font-display text-lg text-accent underline-offset-4 hover:underline"
            >
              {CONTACT_PHONE} <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
