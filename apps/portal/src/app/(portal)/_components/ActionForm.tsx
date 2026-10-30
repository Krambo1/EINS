"use client";

import { startTransition, useRef, type ComponentProps, type FormEvent } from "react";
import { requestFormReset } from "react-dom";
import { showActionFlash } from "./flash-event";

/** Next's redirect and notFound travel as errors and must reach the router. */
function isNavigation(err: unknown): boolean {
  const digest = !!err && typeof err === "object" ? (err as { digest?: unknown }).digest : null;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")
  );
}

/**
 * `<form action={serverAction}>` that survives a lost connection. A plain
 * form action that fails opens the page's error screen, and React has
 * already emptied the fields by then. Here a failure keeps everything typed
 * and says so in the toast; a save that works empties the form as before,
 * once the new page is in. The submit button still sees the save through
 * `useFormStatus` (PendingSubmit), and without JavaScript the form posts as
 * usual.
 */
export function ActionForm({
  action,
  ...props
}: Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (formData: FormData) => unknown;
}) {
  const busy = useRef(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const form = e.currentTarget;
    const formData = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(async () => {
      try {
        await action(formData);
        startTransition(() => requestFormReset(form));
      } catch (err) {
        if (isNavigation(err)) throw err;
        showActionFlash({
          tone: "bad",
          title: "Nicht gespeichert",
          description:
            err instanceof TypeError
              ? "Keine Verbindung. Ihre Eingaben bleiben stehen, bitte versuchen Sie es gleich noch einmal."
              : "Das hat gerade nicht geklappt. Ihre Eingaben bleiben stehen, bitte versuchen Sie es noch einmal.",
        });
      } finally {
        busy.current = false;
      }
    });
  }

  return <form {...props} action={action as (formData: FormData) => void} onSubmit={onSubmit} />;
}
