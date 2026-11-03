"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { cn } from "@eins/ui";
import { SELF_REPORTED_SOURCES, SELF_REPORTED_SOURCE_LABELS } from "@/lib/sources";
import { TREATMENT_OPEN } from "@/lib/manual-entry";
import { PendingSubmit } from "../../_components/PendingSubmit";
import { showActionFlash } from "../../_components/flash-event";
import {
  CardBody,
  FIELD_GRID,
  Field,
  PRIMARY_BUTTON,
  Select,
  TextInput,
} from "../../einstellungen/_components/settings-ui";
import { createManualRequestAction, type ManualEntryState } from "./actions";
import { GUARANTEE_NOTE } from "./_lib/copy";
import { fieldsOf, type ManualEntryField } from "./_lib/fields";
import { FOOT, INVALID, RADIO, SOURCE_GRID, SOURCE_ROW } from "./_lib/sizes";

const CARD = "anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]";

/** The answers in the order of the list, "Sonstiges" last (GOV.UK's radios end on "Other"). */
const SOURCES = [
  ...SELF_REPORTED_SOURCES.filter((s) => s !== "sonstiges"),
  ...SELF_REPORTED_SOURCES.filter((s) => s === "sonstiges"),
];

const EMPTY: Record<ManualEntryField, string> = {
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  treatmentId: TREATMENT_OPEN,
  selfReportedSource: "",
};

const CONTACT: ManualEntryField[] = ["contactPhone", "contactEmail"];

/** `createManualRequestAction`, with a lost connection as an error for the toast instead of the error page. */
async function create(prev: ManualEntryState | undefined, form: FormData): Promise<ManualEntryState | undefined> {
  try {
    // Undefined while Next follows the action's redirect to the new Anfrage.
    return (await createManualRequestAction(prev, form)) ?? prev;
  } catch (err) {
    unstable_rethrow(err);
    return { kind: "error", message: "Keine Verbindung. Ihre Angaben bleiben stehen, bitte tippen Sie gleich noch einmal." };
  }
}

/**
 * "Anfrage anlegen" as one card (HubSpot's "Create contact", Pipedrive's
 * "Add lead"; the fields of the Einstellungen cards): Name, Telefon and
 * E-Mail with the one hint for the pair, the Behandlung as the device's own
 * list, the way in as a column of circles (GOV.UK, Primer). The guarantee
 * sentence sits beside the button, above it on the phone; the button greys
 * out while the Anfrage is created (no optimistic step: the next page is the
 * Anfrage). An error goes to the toast and rings the field it is about; the
 * entries stay (the fields hold their values, so React's reset after the
 * action leaves them) and the card keeps its size.
 */
export function ManualEntryForm({ treatments }: { treatments: Array<{ id: string; name: string }> }) {
  const [state, formAction] = useActionState(create, { kind: "idle" });
  const [values, setValues] = useState(EMPTY);
  const [invalid, setInvalid] = useState<ManualEntryField[]>([]);

  useEffect(() => {
    if (state?.kind !== "error") return;
    setInvalid(fieldsOf(state.message));
    showActionFlash({ tone: "bad", title: "Anfrage nicht angelegt", description: state.message });
  }, [state]);

  const ring = (f: ManualEntryField) => (invalid.includes(f) ? INVALID : undefined);
  const aria = (f: ManualEntryField) => (invalid.includes(f) ? true : undefined);
  // Typing in a ringed field takes its ring away; with both contact fields
  // ringed ("one of both"), typing in either takes both.
  const edit = (f: ManualEntryField) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setValues((cur) => ({ ...cur, [f]: value }));
    setInvalid((cur) => {
      const pair = CONTACT.includes(f) && CONTACT.every((c) => cur.includes(c));
      return cur.filter((x) => x !== f && !(pair && CONTACT.includes(x)));
    });
  };

  return (
    <form action={formAction} aria-label="Anfrage anlegen" className={CARD}>
      <CardBody className="space-y-5 pt-5 md:pt-6">
        <Field label="Name" htmlFor="manual-name">
          <TextInput
            id="manual-name"
            name="contactName"
            required
            maxLength={200}
            autoComplete="off"
            value={values.contactName}
            onChange={edit("contactName")}
            aria-invalid={aria("contactName")}
            className={ring("contactName")}
          />
        </Field>

        <div>
          <div className={FIELD_GRID}>
            <Field label="Telefon" htmlFor="manual-phone">
              <TextInput
                id="manual-phone"
                name="contactPhone"
                type="tel"
                inputMode="tel"
                maxLength={64}
                autoComplete="off"
                aria-describedby="manual-contact-hint"
                value={values.contactPhone}
                onChange={edit("contactPhone")}
                aria-invalid={aria("contactPhone")}
                className={ring("contactPhone")}
              />
            </Field>
            <Field label="E-Mail" htmlFor="manual-email">
              <TextInput
                id="manual-email"
                name="contactEmail"
                type="email"
                maxLength={254}
                autoComplete="off"
                aria-describedby="manual-contact-hint"
                value={values.contactEmail}
                onChange={edit("contactEmail")}
                aria-invalid={aria("contactEmail")}
                className={ring("contactEmail")}
              />
            </Field>
          </div>
          <p id="manual-contact-hint" className="mt-1.5 text-sm leading-5 text-fg-secondary">
            Eines von beiden genügt.
          </p>
        </div>

        <div className={FIELD_GRID}>
          <Field label="Behandlung" htmlFor="manual-treatment">
            <Select
              id="manual-treatment"
              name="treatmentId"
              value={values.treatmentId}
              onChange={edit("treatmentId")}
              aria-invalid={aria("treatmentId")}
              className={cn("rounded-[var(--r-control)]", ring("treatmentId"))}
            >
              <option value={TREATMENT_OPEN}>Noch offen</option>
              {treatments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset
          aria-invalid={aria("selfReportedSource")}
          className={cn("-mx-2 rounded-[var(--r-panel)] px-2 pb-1", ring("selfReportedSource"))}
        >
          <legend className="flex min-h-6 items-center text-sm font-medium leading-5 text-fg-primary">
            Wie kam die Person zu Ihnen?
          </legend>
          <div className={cn("mt-1.5", SOURCE_GRID)}>
            {SOURCES.map((s) => (
              <label key={s} className={SOURCE_ROW}>
                <input
                  type="radio"
                  name="selfReportedSource"
                  value={s}
                  required
                  checked={values.selfReportedSource === s}
                  onChange={edit("selfReportedSource")}
                  className={RADIO}
                />
                <span className="text-[15px] leading-6 text-fg-primary">{SELF_REPORTED_SOURCE_LABELS[s]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </CardBody>
      <div className={FOOT}>
        <p className="min-w-0 text-sm leading-5 text-fg-secondary">{GUARANTEE_NOTE}</p>
        <PendingSubmit className={cn(PRIMARY_BUTTON, "shrink-0")}>Anfrage anlegen</PendingSubmit>
      </div>
    </form>
  );
}
