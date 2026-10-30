"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CARD_TITLE, CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { ScrollHint } from "@/app/_components/ScrollHint";
import {
  REPLY_BUCKET_ORDER,
  fillTemplate,
  templateParts,
  templatesByBucket,
  type ReplyBucket,
  type ReplyTemplate,
} from "../_lib/reply-templates";
import { TEMPLATE_SLOTS, TEMPLATE_WELL_HEIGHT } from "../_lib/sizes";

/** Short names for the switch: the stars say which reviews a group fits. */
export const BUCKET_SWITCH_LABELS: Record<ReplyBucket, string> = {
  positiv: "4-5 Sterne",
  neutral: "3 Sterne",
  kritisch: "1-2 Sterne",
};

/**
 * Antwortvorlagen as one card of fixed height (DESIGN.md section 10): a
 * switch for the three groups in the header (the period switch's track and
 * marker), then three slots, each the title with "Kopieren" in one row and
 * the text in a well of normal size that scrolls when it is longer. The
 * group with two templates leaves its third slot empty. Switching changes
 * the words, never the size; the accordion it replaces grew the card and
 * moved the Verlauf.
 *
 * The Praxis name is already filled in and what is left to replace is
 * marked (Synup's filled wildcards, Help Scout's variables); "Kopieren"
 * copies the filled text.
 */
export function ReplyTemplatesCard({ praxisName = null }: { praxisName?: string | null }) {
  const [bucket, setBucket] = useState<ReplyBucket>("positiv");
  const templates = templatesByBucket(bucket);

  return (
    <section className="anim-rise elev-card lift min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 [--delay:60ms] md:px-6 md:pb-6 md:pt-6">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
        <div className="min-w-0">
          <h2 className={CARD_TITLE}>Antwortvorlagen</h2>
          <p className="mt-1 text-sm leading-5 text-fg-secondary">
            Ersetzen Sie die markierten Stellen, bevor Sie antworten.
          </p>
        </div>
        <BucketSwitch value={bucket} onChange={setBucket} />
      </header>

      <ul className="mt-5 space-y-5">
        {Array.from({ length: TEMPLATE_SLOTS }, (_, i) => {
          const tpl = templates[i];
          return tpl ? (
            <TemplateSlot key={tpl.id} tpl={tpl} text={fillTemplate(tpl.text, { praxisname: praxisName })} />
          ) : (
            // The empty slot keeps the card's height.
            <li key={`empty-${i}`} aria-hidden className="invisible">
              <div className="flex h-[var(--control-h)] items-center" />
              <div className={cn("mt-2", TEMPLATE_WELL_HEIGHT)} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TemplateSlot({ tpl, text }: { tpl: ReplyTemplate; text: string }) {
  return (
    <li>
      <div className="flex h-[var(--control-h)] items-center justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-medium leading-5 text-fg-primary">{tpl.title}</h3>
        <CopyTemplateButton text={text} title={tpl.title} />
      </div>
      <ScrollHint className="mt-2">
        <div
          role="region"
          aria-label={`Vorlage: ${tpl.title}`}
          tabIndex={0}
          className={cn(
            "scroll-shadows elev-inset rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            TEMPLATE_WELL_HEIGHT
          )}
        >
          <p className="whitespace-pre-wrap break-words">
            <TemplateText text={text} />
          </p>
        </div>
      </ScrollHint>
    </li>
  );
}

/** The text with each placeholder still to replace marked. */
export function TemplateText({ text }: { text: string }) {
  return (
    <>
      {templateParts(text).map((part, i) =>
        part.placeholder ? (
          <mark
            key={i}
            className="rounded-[var(--r-mark)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] px-0.5 text-fg-primary"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

/**
 * The three groups as a switch: track pressed into the card, the open group
 * raised. Full width on the phone, under the title.
 */
export function BucketSwitch({
  value,
  onChange,
  className,
}: {
  value: ReplyBucket;
  onChange: (b: ReplyBucket) => void;
  className?: string;
}) {
  const index = REPLY_BUCKET_ORDER.indexOf(value);
  return (
    <div
      role="radiogroup"
      aria-label="Vorlagen für"
      className={cn(
        "elev-inset relative grid h-[var(--track-h)] w-full grid-cols-3 gap-1 rounded-[var(--r-panel)] bg-[var(--well)] p-1 sm:inline-grid sm:w-auto",
        className
      )}
    >
      <span
        aria-hidden
        className="elev-raised pointer-events-none absolute bottom-1 left-1 top-1 w-[calc((100%-1rem)/3)] rounded-[var(--r-control)] bg-[var(--surface-raised)] transition-transform duration-300 ease-expo"
        style={{ transform: `translateX(calc(${index} * (100% + 0.25rem)))` }}
      />
      {REPLY_BUCKET_ORDER.map((b) => (
        <button
          key={b}
          type="button"
          role="radio"
          aria-checked={b === value}
          onClick={() => onChange(b)}
          className={cn(
            "relative whitespace-nowrap rounded-[var(--r-control)] px-2 text-sm font-medium transition-colors duration-300 sm:px-3.5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            b === value ? "text-fg-primary" : "text-fg-secondary hover:text-fg-primary"
          )}
        >
          {BUCKET_SWITCH_LABELS[b]}
        </button>
      ))}
    </div>
  );
}

/**
 * One tap copies; the toast confirms. The button keeps its label and width,
 * only the icon turns into a tick for a moment.
 */
function CopyTemplateButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      showActionFlash({ tone: "good", title: "Vorlage kopiert", description: title });
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht kopiert",
        description: "Ihr Browser hat das Kopieren nicht erlaubt. Markieren Sie den Text und kopieren Sie ihn selbst.",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      aria-label={`${title} kopieren`}
      className={cn(RAISED_CONTROL, CONTROL, "shrink-0 px-3.5")}
    >
      {copied ? <Check className="h-4 w-4 text-tone-good" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      Kopieren
    </Button>
  );
}
