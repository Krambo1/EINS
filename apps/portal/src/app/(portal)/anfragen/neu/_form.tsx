"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eins/ui";
import { UserPlus } from "lucide-react";
import { SELF_REPORTED_SOURCES, SELF_REPORTED_SOURCE_LABELS } from "@/lib/sources";
import { TREATMENT_OPEN } from "@/lib/manual-entry";
import { createManualRequestAction, type ManualEntryState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      <UserPlus className="h-4 w-4" aria-hidden />
      {pending ? "Wird angelegt …" : "Anfrage anlegen"}
    </Button>
  );
}

export function ManualEntryForm({
  treatments,
}: {
  treatments: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState<ManualEntryState | undefined, FormData>(
    createManualRequestAction,
    { kind: "idle" }
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="manual-name">Name</Label>
        <Input
          id="manual-name"
          name="contactName"
          required
          maxLength={200}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="manual-phone">Telefon</Label>
          <Input
            id="manual-phone"
            name="contactPhone"
            type="tel"
            inputMode="tel"
            maxLength={64}
            autoComplete="off"
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="manual-email">E-Mail</Label>
          <Input
            id="manual-email"
            name="contactEmail"
            type="email"
            maxLength={254}
            autoComplete="off"
          />
        </div>
      </div>
      <p className="-mt-2 text-sm text-fg-primary">
        Telefon oder E-Mail genügt, eines von beiden brauchen wir.
      </p>

      <div className="space-y-2">
        <Label htmlFor="manual-treatment">Behandlung</Label>
        <Select name="treatmentId" defaultValue={TREATMENT_OPEN}>
          <SelectTrigger id="manual-treatment" className="w-full sm:max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TREATMENT_OPEN}>Noch offen</SelectItem>
            {treatments.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-fg-primary">
          Wie kam die Person zu Ihnen?
        </legend>
        <div className="flex flex-wrap gap-2">
          {SELF_REPORTED_SOURCES.map((s) => (
            <label
              key={s}
              className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-sm text-fg-primary transition-colors hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
            >
              <input type="radio" name="selfReportedSource" value={s} required className="sr-only" />
              {SELF_REPORTED_SOURCE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.kind === "error" && (
        <div
          role="alert"
          className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad"
        >
          {state.message}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-primary">
          Notizen schreiben Sie danach direkt bei der Anfrage.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
