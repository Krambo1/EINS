"use client";

import { useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@eins/ui";
import { ScrollHint } from "@/app/_components/ScrollHint";

/**
 * The note sent with a file, as one icon at the end of the meta line (the
 * signal slot of Linear's rows; its focus ring sits inside, the meta line
 * cuts anything outside) with the note and its author in a card like
 * Attio's hover card. It opens on hover and on a tap, and floats outside the
 * list (portal), so the list's own scroll never cuts it. A long note scrolls
 * inside the card at normal text size.
 */
export function NoteSignal({ note, author }: { note: string; author: string | null }) {
  const [open, setOpen] = useState(false);
  // Leaving the icon closes the card a moment later, so the pointer can move
  // onto it and scroll a long note.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const title = author ? `Notiz von ${author}` : "Notiz";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={title}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        // With a mouse the card is already open from the hover; a click
        // keeps it open instead of toggling it shut. A tap toggles.
        onClick={(e) => {
          if ((e.nativeEvent as PointerEvent).pointerType === "mouse") {
            e.preventDefault();
            show();
          }
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--r-small)] text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <MessageSquareText className="h-4 w-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        // Opening on hover must not pull the focus out of the list.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        className="w-80 rounded-[var(--r-panel)] border-0 bg-[var(--surface-tile)] p-3 elev-popover"
      >
        <p className="text-sm font-semibold leading-5 text-fg-primary">{title}</p>
        <ScrollHint className="mt-1">
          <p className="scroll-shadows max-h-40 whitespace-pre-line break-words text-sm leading-5 text-fg-primary [--scroll-bg:var(--surface-tile)]">
            {note}
          </p>
        </ScrollHint>
      </PopoverContent>
    </Popover>
  );
}
