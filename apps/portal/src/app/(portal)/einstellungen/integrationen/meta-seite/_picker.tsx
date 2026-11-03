"use client";

import { useActionState, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, cn } from "@eins/ui";
import { showActionFlash } from "@/app/(portal)/_components/flash-event";
import { WASH_AREA, WASH_ROW } from "@/app/(portal)/dashboard/_components/dash-ui";
import { CardBody, CardFoot, PRIMARY_BUTTON, Status } from "../../_components/settings-ui";
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
  // Same words while it runs, so the button keeps its size; the toast or
  // the Werbekonten card says how it went.
  return (
    <Button
      type="submit"
      className={PRIMARY_BUTTON}
      disabled={disabled || pending || !hydrated}
      aria-busy={pending}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (confirmSwitch && !window.confirm(SWITCH_CONFIRM)) e.preventDefault();
      }}
    >
      Diese Seite verbinden
    </Button>
  );
}

export function MetaPagePicker({
  pages,
  hasCurrent,
  children,
}: {
  pages: PickerPage[];
  hasCurrent: boolean;
  /** A sentence above the list (a page that is gone, the only page). */
  children?: ReactNode;
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

  // A refusal comes back as state (success redirects): it goes to the toast,
  // so the card keeps its height.
  useEffect(() => {
    if (state?.error) showActionFlash({ tone: "bad", title: "Seite nicht verbunden", description: state.error });
  }, [state]);

  return (
    <form action={action}>
      <CardBody className="space-y-3 pt-2">
        {children}
        <fieldset>
          <legend className="sr-only">Seite Ihrer Praxis</legend>
          {/* Hairline rows like the Werbekonten; the grey of a row keeps its
              room to the lines (DESIGN.md section 5). */}
          <ul className="divide-y divide-border">
            {pages.map((p) => {
              const inputId = `meta-page-${p.id}`;
              return (
                <li key={p.id} className={WASH_ROW}>
                  <label
                    htmlFor={inputId}
                    className={cn(
                      WASH_AREA,
                      "flex items-start gap-3 rounded-[var(--r-control)] py-3",
                      p.boundElsewhere
                        ? "cursor-not-allowed"
                        : "cursor-pointer transition-colors hover:bg-[var(--hover-wash)]"
                    )}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name="pageId"
                      value={p.id}
                      disabled={p.boundElsewhere}
                      checked={selected === p.id}
                      onChange={() => setSelected(p.id)}
                      className="mt-0.5 h-5 w-5 shrink-0 cursor-[inherit] accent-fg-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block break-words text-[15px] font-medium leading-6",
                          p.boundElsewhere ? "text-fg-secondary" : "text-fg-primary"
                        )}
                      >
                        {p.name || "Seite ohne Namen"}
                      </span>
                      <span className="block break-all text-sm leading-5 text-fg-secondary">Seiten-ID {p.id}</span>
                      {p.current && (
                        <Status tone="good" className="mt-1 flex">
                          Aktuell verbunden
                        </Status>
                      )}
                      {p.boundElsewhere && (
                        <Status tone="none" className="mt-1 flex">
                          Mit einer anderen Praxis verbunden
                        </Status>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        {pages.some((p) => p.boundElsewhere) && (
          <p className="text-sm leading-5 text-fg-secondary">
            Eine Seite, die schon mit einer anderen Praxis verbunden ist, können Sie nicht wählen. Ist das Ihre
            Seite, melden Sie sich bitte bei EINS.
          </p>
        )}
      </CardBody>
      <CardFoot>
        <SubmitButton disabled={selected === null} confirmSwitch={confirmSwitch} />
      </CardFoot>
    </form>
  );
}
