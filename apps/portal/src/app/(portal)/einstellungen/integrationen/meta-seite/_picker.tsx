"use client";

import { useActionState, useEffect, useState, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Button } from "@eins/ui";
import { chooseMetaPageAction, type MetaPagePickState } from "./actions";

/**
 * E6 picker form. Gets page ids and names only (no token ever reaches the
 * browser); the server action re-checks the id against a fresh
 * /me/accounts list and binds it for the session's Praxis.
 */

export interface PickerPage {
  id: string;
  name: string;
  current: boolean;
  boundElsewhere: boolean;
}

const SWITCH_CONFIRM =
  "Seite wechseln? Anfragen aus den Meta-Formularen der bisherigen Seite kommen danach nicht mehr in Ihrem Portal an.";

function SubmitButton({
  disabled,
  confirmSwitch,
}: {
  disabled: boolean;
  confirmSwitch: boolean;
}) {
  const { pending } = useFormStatus();
  // Before hydration the onClick confirm does not exist yet and a click
  // would submit unasked (portal-wide guard): stay disabled until hydrated.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <Button
      type="submit"
      disabled={disabled || pending || !hydrated}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (confirmSwitch && !window.confirm(SWITCH_CONFIRM)) e.preventDefault();
      }}
    >
      {pending ? "Wird verbunden…" : "Diese Seite verbinden"}
    </Button>
  );
}

export function MetaPagePicker({
  pages,
  hasCurrent,
}: {
  pages: PickerPage[];
  hasCurrent: boolean;
}) {
  const [state, action] = useActionState<MetaPagePickState, FormData>(
    chooseMetaPageAction,
    undefined
  );
  const selectable = pages.filter((p) => !p.boundElsewhere);
  const initial =
    pages.find((p) => p.current && !p.boundElsewhere)?.id ??
    (selectable.length === 1 ? selectable[0]!.id : null);
  const [selected, setSelected] = useState<string | null>(initial);
  const selectedPage = pages.find((p) => p.id === selected) ?? null;
  // Re-binding moves the Meta-Anfragen to another page: ask first.
  const confirmSwitch = hasCurrent && selectedPage !== null && !selectedPage.current;

  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-fg-primary">
          Seite Ihrer Praxis
        </legend>
        {pages.map((p) => {
          const inputId = `meta-page-${p.id}`;
          return (
            <label
              key={p.id}
              htmlFor={inputId}
              className={[
                "flex min-h-11 items-start gap-3 rounded-xl border p-3",
                p.boundElsewhere
                  ? "cursor-not-allowed border-border bg-bg-secondary"
                  : "cursor-pointer border-border bg-bg-primary hover:bg-bg-secondary",
                selected === p.id ? "!border-fg-primary" : "",
              ].join(" ")}
            >
              <input
                id={inputId}
                type="radio"
                name="pageId"
                value={p.id}
                disabled={p.boundElsewhere}
                checked={selected === p.id}
                onChange={() => setSelected(p.id)}
                className="mt-1 h-5 w-5 shrink-0 accent-fg-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-base font-medium text-fg-primary">
                  {p.name || "Seite ohne Namen"}
                </span>
                <span className="block break-all text-sm text-fg-secondary">
                  Seiten-ID {p.id}
                </span>
                {(p.current || p.boundElsewhere) && (
                  <span className="mt-1 flex flex-wrap gap-2">
                    {p.current && <Badge tone="good">Aktuell verbunden</Badge>}
                    {p.boundElsewhere && (
                      <Badge tone="neutral">
                        Mit einer anderen Praxis verbunden
                      </Badge>
                    )}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      {pages.some((p) => p.boundElsewhere) && (
        <p className="text-sm text-fg-primary">
          Eine Seite, die schon mit einer anderen Praxis verbunden ist, können
          Sie nicht wählen. Ist das Ihre Seite, melden Sie sich bitte bei EINS.
        </p>
      )}

      {state?.error && (
        <p role="alert" className="text-sm text-tone-bad">
          {state.error}
        </p>
      )}

      <SubmitButton disabled={selected === null} confirmSwitch={confirmSwitch} />
    </form>
  );
}
