"use client";

import * as React from "react";
import Image from "next/image";
import type { Clinic, Treatment } from "@/lib/types";
import { telLink, whatsappLink } from "@/lib/format";
import type { Branch } from "./types";

interface Props {
  clinic: Clinic;
  treatment: Treatment;
  branch: Branch;
  firstName: string;
  email: string;
  eventId: string;
}

/**
 * Confirmation screen v2.
 *
 * The moment of highest commitment — used for (1) an immediate booking embed
 * when the Praxis has one, (2) a concrete callback window, (3) the "So geht
 * es weiter" strip that kills post-submit anxiety, and (4) the marketing
 * opt-in that moved OUT of the quiz (double-opt-in flow unchanged).
 */
export function Confirmation({ clinic, treatment, branch, firstName, email, eventId }: Props) {
  const responsePromise = clinic.responsePromise ?? "innerhalb eines Werktags";
  const isSvgPortrait = clinic.doctor.portrait.endsWith(".svg");

  return (
    <div className="step-enter">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-primary-soft">
          <svg
            width="20"
            height="20"
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
        <div>
          <h3 className="text-lg font-semibold text-brand-fg sm:text-xl">
            {firstName ? `Vielen Dank, ${firstName}.` : "Vielen Dank."} Ihre Anfrage ist eingegangen.
          </h3>
          <p className="mt-1 text-sm text-brand-fg-muted">{treatment.h1}</p>
        </div>
      </div>

      {branch === "qualified" ? (
        <p className="mt-4 text-sm leading-relaxed text-brand-fg-muted">
          Das Praxisteam meldet sich {responsePromise} telefonisch zur Terminabstimmung.
          {clinic.contact.bookingUrl
            ? " Wenn Sie möchten, wählen Sie unten direkt einen Termin."
            : ""}
        </p>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-brand-fg-muted">
          Sie erhalten in Kürze kompakte Informationen per E-Mail. Es ruft Sie niemand an.
          Melden Sie sich gerne, sobald Sie konkret werden möchten.
        </p>
      )}

      {branch === "qualified" && clinic.contact.bookingUrl && (
        <div className="mt-4 overflow-hidden rounded-brand border border-brand-border">
          <iframe
            src={clinic.contact.bookingUrl}
            title={`Termin bei ${clinic.name}`}
            className="h-[560px] w-full"
            loading="lazy"
            allow="payment"
          />
        </div>
      )}

      {/* So geht es weiter */}
      <div className="mt-5 rounded-brand border border-brand-border bg-brand-bg-soft p-4">
        <p className="text-sm font-semibold text-brand-fg">So geht es weiter</p>
        <ol className="mt-2 space-y-1.5 text-sm text-brand-fg-muted">
          <li className="flex gap-2">
            <span className="font-medium text-brand-primary">1.</span>
            Das Praxisteam sichtet Ihre Angaben.
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-brand-primary">2.</span>
            {branch === "qualified"
              ? `Sie erhalten ${responsePromise} eine Rückmeldung mit Terminvorschlag.`
              : "Sie erhalten die Informationen per E-Mail."}
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-brand-primary">3.</span>
            {branch === "qualified"
              ? `Ihr Beratungsgespräch bei ${clinic.doctor.name}, unverbindlich und vertraulich.`
              : "Wenn es für Sie passt, vereinbaren wir ein unverbindliches Beratungsgespräch."}
          </li>
        </ol>
        <div className="mt-3 flex items-center gap-2.5 border-t border-brand-border pt-3">
          <span className="relative block h-9 w-9 overflow-hidden rounded-full bg-brand-primary-soft">
            {isSvgPortrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clinic.doctor.portrait}
                alt={clinic.doctor.portraitAlt}
                className="h-full w-full object-cover"
              />
            ) : (
              <Image
                src={clinic.doctor.portrait}
                alt={clinic.doctor.portraitAlt}
                fill
                sizes="36px"
                className="object-cover"
              />
            )}
          </span>
          <p className="text-xs leading-snug text-brand-fg-muted">
            <span className="font-medium text-brand-fg">{clinic.doctor.name}</span>
            <br />
            {clinic.doctor.facharzt}
          </p>
        </div>
      </div>

      <MarketingOptIn
        clinic={clinic}
        treatment={treatment}
        email={email}
        firstName={firstName}
        eventId={eventId}
      />

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

type OptInStatus = "idle" | "sending" | "sent" | "error";

/**
 * Marketing opt-in AFTER the lead is in. POSTs to /api/lead/marketing-optin,
 * which sends the same signed double-opt-in email the quiz-checkbox flow
 * used to trigger. Consent only becomes effective when the patient clicks
 * the link in the email (§ 7 UWG).
 */
function MarketingOptIn({
  clinic,
  treatment,
  email,
  firstName,
  eventId,
}: {
  clinic: Clinic;
  treatment: Treatment;
  email: string;
  firstName: string;
  eventId: string;
}) {
  const [status, setStatus] = React.useState<OptInStatus>("idle");

  const onOptIn = async () => {
    setStatus("sending");
    try {
      const res = await fetch("/api/lead/marketing-optin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clinicSlug: clinic.slug,
          treatmentSlug: treatment.slug,
          email,
          firstName: firstName || undefined,
          eventId,
        }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div
        role="status"
        className="mt-4 rounded-brand border border-brand-border bg-brand-bg-soft p-3 text-sm text-brand-fg-muted"
      >
        <strong className="text-brand-fg">Bestätigungs-E-Mail unterwegs.</strong> Bitte klicken Sie
        auf den Link in der E-Mail (Double-Opt-In). Der Link ist 48 Stunden gültig.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-brand border border-brand-border p-3">
      <p className="text-sm text-brand-fg">
        Möchten Sie vorab Informationen zur Behandlung von {clinic.name} per E-Mail erhalten?
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onOptIn}
          disabled={status === "sending"}
          className="btn btn-secondary !min-h-[42px] text-sm"
        >
          {status === "sending" ? "Senden …" : "Ja, Informationen erhalten"}
        </button>
        <span className="text-xs text-brand-fg-muted">Jederzeit widerrufbar.</span>
      </div>
      {status === "error" && (
        <p className="mt-2 text-xs text-red-600">
          Das hat nicht geklappt. Bitte versuchen Sie es später erneut.
        </p>
      )}
    </div>
  );
}
