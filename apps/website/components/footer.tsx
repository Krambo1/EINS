import Image from "next/image";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/constants";
import { CookieSettingsButton } from "@/components/cookie-consent";

export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-primary py-10">
      <div className="container flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Image src="/eins-logo.svg" alt="EINS" width={600} height={240} className="h-6 w-auto" />
          <div className="font-mono text-sm text-fg-primary">
            EINS · Köln, DE ·{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-fg-primary transition-colors hover:text-accent">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-6 font-mono text-sm text-fg-primary">
          <Link href="/impressum" className="transition-colors hover:text-accent">
            Impressum
          </Link>
          <Link href="/datenschutz" className="transition-colors hover:text-accent">
            Datenschutz
          </Link>
          <CookieSettingsButton className="transition-colors hover:text-accent" />
        </div>
      </div>
      <div className="container mt-6 font-mono text-xs text-fg-secondary">
        © {new Date().getFullYear()} EINS. Alle Rechte vorbehalten.
      </div>
    </footer>
  );
}
