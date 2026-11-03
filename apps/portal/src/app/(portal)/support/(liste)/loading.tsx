"use client";

import { useSearchParams } from "next/navigation";
import { SquarePen } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { PageHeader } from "../../_components/PageHeader";
import { CONTROL, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { CardBody, CardFoot, Field, PRIMARY_BUTTON } from "../../einstellungen/_components/settings-ui";
import { FIELD, SKELETON_BAR } from "../../einstellungen/_lib/sizes";
import { SupportHead } from "../_components/SupportHead";
import { KI_NOTE, NEW_MESSAGE_PARAM, PRIVACY_NOTE } from "../_lib/labels";
import {
  LIST_BODY_HEIGHT,
  LIST_CARD,
  LIST_SLOTS,
  MESSAGE_HEIGHT,
  NEW_BUTTON,
  PAGE_WIDTH,
  ROW_HEIGHT,
  STACK,
  TEXT_AREA,
} from "../_lib/sizes";

/**
 * The list, or the new message with `?neu=1`, while it loads: the same head,
 * card, rows and fields at the same sizes (_lib/sizes.ts), so nothing moves
 * when the page arrives. In the route group (liste), so a conversation keeps
 * its own skeleton.
 */
export default function Loading() {
  const writing = useSearchParams().get(NEW_MESSAGE_PARAM) === "1";
  return (
    <div className={PAGE_WIDTH} aria-busy="true" aria-live="polite" aria-label="Nachrichten werden geladen">
      {writing ? (
        <div className={STACK}>
          <SupportHead title="Neue Nachricht" />
          <div className="anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]">
            <CardBody className="space-y-5 pt-5 md:pt-6">
              <Field label="Betreff">
                <div className={FIELD} />
              </Field>
              <Field label="Nachricht">
                <div className={cn(TEXT_AREA, MESSAGE_HEIGHT)} />
                <p className="mt-1.5 text-sm leading-5 text-fg-secondary">{PRIVACY_NOTE}</p>
              </Field>
            </CardBody>
            <CardFoot start={<p className="text-sm leading-5 text-fg-secondary">{KI_NOTE}</p>}>
              <Button disabled className={PRIMARY_BUTTON}>
                Senden
              </Button>
            </CardFoot>
          </div>
        </div>
      ) : (
        <div className={STACK}>
          <PageHeader
            title="Nachrichten an EINS"
            actions={
              <Button disabled className={cn(CONTROL, NEW_BUTTON, "disabled:opacity-100")}>
                <SquarePen className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Neue Nachricht</span>
              </Button>
            }
          />
          <section className={LIST_CARD}>
            <ul className={cn("-mx-3 divide-y divide-border overflow-hidden px-3", LIST_BODY_HEIGHT)}>
              {Array.from({ length: LIST_SLOTS }, (_, i) => (
                <li key={i} className={WASH_ROW}>
                  <span className={cn("block py-3", WASH_AREA, ROW_HEIGHT)}>
                    <span className="flex h-5 items-center justify-between gap-3">
                      <span className={cn(SKELETON_BAR, "h-4 w-56 max-w-[60%]")} />
                      <span className={cn(SKELETON_BAR, "h-3.5 w-20")} />
                    </span>
                    <span className="mt-1 flex h-5 items-center">
                      <span className={cn(SKELETON_BAR, "h-3.5 w-16")} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
