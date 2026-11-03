"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL, TABLE_HEAD_BAND } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { TemplateText } from "../../bewertungen/_components/ReplyTemplatesCard";
import { fillTemplate } from "../../bewertungen/_lib/reply-templates";
import type { LEITFADEN_PAGE } from "../content";
import type { Block } from "../_lib/sections";

export type Labels = typeof LEITFADEN_PAGE;

/**
 * The page's labels (`LEITFADEN_PAGE` in content.ts) and the Praxis name,
 * handed down from the server once, so the browser never loads content.ts.
 */
export const LeitfadenContext = createContext<{ labels: Labels; praxisName: string | null } | null>(null);

export function useLeitfaden() {
  const ctx = useContext(LeitfadenContext);
  if (!ctx) throw new Error("useLeitfaden outside LeitfadenContext");
  return ctx;
}

/** Cadence columns and Sag-so pairs side by side from lg; stacked below. */
const CADENCE_COLUMNS = "lg:grid-cols-[11rem_9rem_minmax(0,1fr)] lg:gap-4";

/** What an opened row shows: its blocks in order. */
export function ItemBody({ title, blocks }: { title: string; blocks: Block[] }) {
  return (
    <div className="space-y-3 pb-4 pt-1">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} title={title} />
      ))}
    </div>
  );
}

function BlockView({ block, title }: { block: Block; title: string }) {
  const { labels } = useLeitfaden();
  switch (block.kind) {
    case "line":
      return <p className="text-[15px] leading-6 text-fg-primary">{block.text}</p>;
    case "well":
      return <TextWell label={block.label} text={block.text} title={title} />;
    case "note":
      return <p className="text-sm leading-5 text-fg-primary">{block.text}</p>;
    case "list":
      return <Lines items={block.items} ordered={block.ordered} />;
    case "avoid":
      // Shopify's Don't: the cross and the word once, the phrases as plain
      // dark lines under it.
      return (
        <div>
          <p className="flex items-center gap-1.5 text-[15px] font-medium leading-6 text-fg-primary">
            <X className="h-4 w-4 shrink-0 text-tone-bad" aria-hidden />
            {labels.avoid}
          </p>
          <Lines items={block.items} className="mt-1" />
        </div>
      );
    case "pairs":
      return <Pairs rows={block.rows} />;
    case "cadence":
      // Stripe's compact table: the head band once, rows between hairlines.
      // Below lg each row stacks: when, the channel, what to do.
      return (
        <div>
          <div className={cn(TABLE_HEAD_BAND, "hidden items-center px-3 lg:grid", CADENCE_COLUMNS)}>
            <span>{labels.cadenceColumns.time}</span>
            <span>{labels.cadenceColumns.channel}</span>
            <span>{labels.cadenceColumns.purpose}</span>
          </div>
          <ul className="divide-y divide-border">
            {block.rows.map((r) => (
              <li key={r.time} className={cn("grid py-3 text-[15px] leading-6 text-fg-primary lg:px-3", CADENCE_COLUMNS)}>
                <span className="font-medium">{r.time}</span>
                <span className="text-sm leading-6 text-fg-secondary lg:text-[15px] lg:text-fg-primary">{r.channel}</span>
                <span>{r.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

/** Lines between hairlines (Stripe's details list), numbered when the order counts. */
function Lines({ items, ordered = false, className }: { items: string[]; ordered?: boolean; className?: string }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={cn("divide-y divide-border border-y border-border", className)}>
      {items.map((t, n) => (
        <li key={n} className="flex gap-3 py-2 text-[15px] leading-6 text-fg-primary">
          {ordered && <span className="w-5 shrink-0 tabular-nums text-fg-secondary">{n + 1}.</span>}
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </List>
  );
}

/**
 * Sag so, nicht so after Shopify's Do/Don't pair: "So sagen" first, tick and
 * cross with their words in the head band once (from lg), each line with its
 * icon below lg. Dark text, no tint, no coloured border; colour is never the
 * only signal.
 */
function Pairs({ rows }: { rows: { good: string; bad: string }[] }) {
  const { labels } = useLeitfaden();
  return (
    <div>
      <div className={cn(TABLE_HEAD_BAND, "hidden grid-cols-2 items-center gap-6 px-3 lg:grid")}>
        <span className="flex items-center gap-1.5 font-medium text-fg-primary">
          <Check className="h-4 w-4 shrink-0 text-tone-good" aria-hidden />
          {labels.saySo}
        </span>
        <span className="flex items-center gap-1.5 font-medium text-fg-primary">
          <X className="h-4 w-4 shrink-0 text-tone-bad" aria-hidden />
          {labels.sayNot}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.good} className="grid gap-2 py-3 text-[15px] leading-6 text-fg-primary lg:grid-cols-2 lg:gap-6 lg:px-3">
            <p className="flex gap-2">
              <Check className="mt-1 h-4 w-4 shrink-0 text-tone-good lg:hidden" aria-hidden />
              <span>
                <span className="sr-only">{labels.saySo}: </span>
                {r.good}
              </span>
            </p>
            <p className="flex gap-2">
              <X className="mt-1 h-4 w-4 shrink-0 text-tone-bad lg:hidden" aria-hidden />
              <span>
                <span className="sr-only">{labels.sayNot}: </span>
                {r.bad}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "[Praxisname]" and the No-Show templates' "[Praxis]" filled in. */
function fillPraxis(text: string, praxisName: string | null): string {
  const filled = fillTemplate(text, { praxisname: praxisName });
  const name = praxisName?.trim();
  return name ? filled.replaceAll("[Praxis]", name) : filled;
}

/**
 * Text to say or send, after Vercel's code block: a well pressed into the
 * card with a head row (the label left, "Kopieren" right, a hairline under
 * it) and the text in plain dark 15 px, line breaks kept. The Praxis name is
 * filled in, what is left to replace is marked (`TemplateText`), and
 * "Kopieren" copies exactly the text shown. The button sits at the top, so a
 * longer text never moves it.
 */
function TextWell({ label, text, title }: { label: string; text: string; title: string }) {
  const { praxisName } = useLeitfaden();
  const filled = fillPraxis(text, praxisName);
  return (
    <div className="elev-inset overflow-hidden rounded-[var(--r-panel)] bg-[var(--well)]">
      <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 pl-4 pr-1.5">
        <span className="text-sm font-medium leading-5 text-fg-secondary">{label}</span>
        <CopyButton text={filled} what={`${title}, ${label}`} />
      </div>
      <p className="whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-6 text-fg-primary">
        <TemplateText text={filled} />
      </p>
    </div>
  );
}

/**
 * One tap copies, the toast confirms (DESIGN.md section 10). The button keeps
 * its label and width; only the icon turns into a tick for a moment.
 */
function CopyButton({ text, what }: { text: string; what: string }) {
  const { labels } = useLeitfaden();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      showActionFlash({ tone: "good", title: labels.copied, description: what });
    } catch {
      showActionFlash({ tone: "bad", title: labels.notCopied, description: labels.notCopiedHint });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      aria-label={`${labels.copy}: ${what}`}
      className={cn(RAISED_CONTROL, CONTROL, "shrink-0 px-3.5")}
    >
      {copied ? <Check className="h-4 w-4 text-tone-good" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {labels.copy}
    </Button>
  );
}

/** GOV.UK's warning mark: a black circle with "!". */
export function WarningMark() {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fg-primary text-sm font-bold leading-none text-[var(--surface-tile)]"
    >
      !
    </span>
  );
}
