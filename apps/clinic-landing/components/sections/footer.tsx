import Link from "next/link";
import type { Clinic } from "@/lib/types";
import { CookieSettingsButton } from "@/components/consent/cookie-consent";
import { formatAddress, telLink } from "@/lib/format";

interface Props {
  clinic: Clinic;
}

export function Footer({ clinic }: Props) {
  return (
    <footer className="border-t border-brand-border bg-brand-bg">
      <div className="container mx-auto py-10">
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <div className="text-base font-semibold text-brand-fg">{clinic.name}</div>
            <p className="mt-2 text-sm text-brand-fg-muted">{clinic.doctor.facharzt}</p>
          </div>
          <div className="text-sm text-brand-fg-muted">
            <div>{formatAddress(clinic.address)}</div>
            <a
              href={telLink(clinic.contact.phoneE164)}
              className="mt-1 block underline-offset-4 hover:text-brand-fg hover:underline"
            >
              {clinic.contact.phoneDisplay}
            </a>
            <a
              href={`mailto:${clinic.contact.email}`}
              className="block underline-offset-4 hover:text-brand-fg hover:underline"
            >
              {clinic.contact.email}
            </a>
          </div>
          <div className="flex flex-col gap-2 text-sm text-brand-fg-muted md:items-end md:text-right">
            <Link
              href="impressum"
              className="underline-offset-4 hover:text-brand-fg hover:underline"
            >
              Impressum
            </Link>
            <Link
              href="datenschutz"
              className="underline-offset-4 hover:text-brand-fg hover:underline"
            >
              Datenschutz
            </Link>
            <CookieSettingsButton />
          </div>
        </div>
        <div className="mt-8 border-t border-brand-border pt-6 text-xs text-brand-fg-muted">
          © {new Date().getFullYear()} {clinic.name}. Alle Rechte vorbehalten.
        </div>
      </div>
    </footer>
  );
}
