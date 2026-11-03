"use client";

import { Fragment, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SquarePen } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { PageHeader } from "../../_components/PageHeader";
import { CONTROL } from "../../dashboard/_components/dash-ui";
import { NEW_MESSAGE_PARAM } from "../_lib/labels";
import { NEW_BUTTON, STACK } from "../_lib/sizes";
import { SupportHead } from "./SupportHead";

/**
 * The list of conversations, or in its place a new message (Zendesk's "My
 * requests" with "Submit a request" at the top right; Help Scout's Beacon
 * opens "Ask" in place of the answers). The list comes first, so who looks
 * for an answer sees it on the first screen; "Neue Nachricht" at the end of
 * the title row opens the form where the list was. Both views come from the
 * server once; the switch only writes `?neu=1` into the address (pushed, so
 * the browser's back returns to the list) and is instant.
 */
export function SupportViews({
  list,
  form,
  canWrite,
}: {
  list: ReactNode;
  form: ReactNode;
  /** Whether there is a new message to write (support set up for the Praxis). */
  canWrite: boolean;
}) {
  const params = useSearchParams();
  const writing = canWrite && params.get(NEW_MESSAGE_PARAM) === "1";

  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // Next keeps its own keys beside this one in the history entry.
    window.history.pushState({ supportFromList: true }, "", `/support?${NEW_MESSAGE_PARAM}=1`);
  };
  const close = () => {
    // Opened from the list: back to it, so the history has no extra step.
    if (window.history.state?.supportFromList) window.history.back();
    else window.history.replaceState(null, "", "/support");
  };

  if (writing) {
    return (
      <div className={STACK}>
        <SupportHead title="Neue Nachricht" onBack={close} />
        {/* Each view on its own: an element from the server in a list of
            children asks for a key after a client-side navigation. */}
        <Fragment>{form}</Fragment>
      </div>
    );
  }
  return (
    <div className={STACK}>
      <PageHeader
        title="Nachrichten an EINS"
        actions={
          canWrite && (
            // A square with its icon on the phone, so the title keeps its line.
            <Button asChild className={cn(CONTROL, NEW_BUTTON)}>
              <Link href={`/support?${NEW_MESSAGE_PARAM}=1`} onClick={open} aria-label="Neue Nachricht">
                <SquarePen className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Neue Nachricht</span>
              </Link>
            </Button>
          )
        }
      />
      <Fragment>{list}</Fragment>
    </div>
  );
}
