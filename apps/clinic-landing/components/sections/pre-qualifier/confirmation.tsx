"use client";

import type { Clinic } from "@/lib/types";
import { telLink, whatsappLink } from "@/lib/format";

interface Props {
  clinic: Clinic;
  branch: "qualified" | "info-only";
  /**
   * True if the patient ticked the marketing checkbox. We then show a notice
   * that a confirmation email is on its way (German double-opt-in).
   */
  marketingPending?: boolean;
}

export function Confirmation({ clinic, branch, marketingPending = false }: Props) {
  return (
    <div className="step-enter rounded-brand-lg border border-brand-border bg-brand-bg p-6 text-center sm:p-8">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary-soft">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-brand-primary"
          aria-hidden
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h3 className="mt-4 text-xl font-semibold text-brand-fg sm:text-2xl">
        Anfrage erhalten — vielen Dank.
      </h3>
      {branch === "qualified" ? (
        <p className="mt-2 text-brand-fg-muted">
          Wir melden uns in der Regel innerhalb eines Werktags zur Terminvereinbarung.
          Wenn Sie sofort einen Termin sichern möchten, wählen Sie unten direkt einen Slot.
        </p>
      ) : (
        <p className="mt-2 text-brand-fg-muted">
          Sie erhalten in Kürze die angefragten Informationen per E-Mail. Es ruft Sie niemand an —
          melden Sie sich gerne, sobald Sie konkret werden möchten.
        </p>
      )}
      {marketingPending && (
        <div
          role="status"
          className="mt-4 rounded-brand border border-brand-border bg-brand-bg-soft p-3 text-left text-sm text-brand-fg-muted"
        >
          <p>
            <strong>Bestätigungs-E-Mail unterwegs.</strong> Damit wir Ihnen Informationen schicken
            dürfen, klicken Sie bitte auf den Bestätigungs-Link in der E-Mail (Double-Opt-In nach
            §&nbsp;7 UWG / Art. 6&nbsp;Abs.&nbsp;1 lit.&nbsp;a DSGVO). Der Link ist 48&nbsp;Stunden
            gültig.
          </p>
        </div>
      )}
      {branch === "qualified" && clinic.contact.bookingUrl && (
        <div className="mt-5 overflow-hidden rounded-brand border border-brand-border">
          <iframe
            src={clinic.contact.bookingUrl}
            title={`Termin bei ${clinic.name}`}
            className="h-[640px] w-full"
            loading="lazy"
            allow="payment"
          />
        </div>
      )}
      <div className="mt-5 flex flex-col items-center justify-center gap-2 text-sm text-brand-fg-muted sm:flex-row">
        <a
          href={telLink(clinic.contact.phoneE164)}
          className="underline underline-offset-4 hover:text-brand-fg"
        >
          {clinic.contact.phoneDisplay}
        </a>
        {clinic.contact.whatsappE164 && (
          <>
            <span aria-hidden>·</span>
            <a
              href={whatsappLink(clinic.contact.whatsappE164, "Hallo, ich habe gerade eine Anfrage gesendet.")}
              className="underline underline-offset-4 hover:text-brand-fg"
            >
              WhatsApp
            </a>
          </>
        )}
      </div>
    </div>
  );
}
