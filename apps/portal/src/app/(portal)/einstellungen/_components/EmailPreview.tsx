"use client";

import { Mail, X } from "lucide-react";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger, cn } from "@eins/ui";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { CARD_TITLE, CONTROL, CONTROL_SQUARE, QUIET_CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";

/**
 * "So sieht die E-Mail aus" in the foot of the Erinnerungen card: the
 * reminder as the patient gets it, in a panel of one size (the "Dateien
 * senden" panel's frame: title row with the raised close, the text in a well
 * that scrolls with the arrow). It used to open inside the card and push it
 * down.
 */
export function EmailPreview({ subject, text }: { subject: string; text: string }) {
  return (
    <Dialog>
      <DialogTrigger className={cn(QUIET_CONTROL, "-ml-2.5")}>
        <Mail className="h-4 w-4" aria-hidden />
        So sieht die E-Mail aus
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(34rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[36rem] flex-col overflow-hidden rounded-[var(--r-card)] border-0 bg-[var(--surface-tile)] p-0 elev-popover md:p-0 [&>button:last-child]:hidden"
      >
        <div className="flex h-[calc(var(--control-h)+1.25rem)] shrink-0 items-end justify-between gap-3 px-5 md:h-[calc(var(--control-h)+1.5rem)] md:px-6">
          <DialogTitle className={CARD_TITLE}>So sieht die E-Mail aus</DialogTitle>
          <DialogClose asChild>
            <Button variant="outline" aria-label="Schließen" className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE)}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4 md:px-6 md:pb-6">
          <p className="text-[15px] leading-6 text-fg-primary">
            <span className="font-medium">Betreff:</span> {subject}
          </p>
          <ScrollHint className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="scroll-shadows elev-inset min-h-0 flex-1 overflow-y-auto whitespace-pre-line rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {text}
            </div>
          </ScrollHint>
        </div>
      </DialogContent>
    </Dialog>
  );
}
