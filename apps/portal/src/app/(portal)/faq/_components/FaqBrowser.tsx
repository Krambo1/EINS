"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Search, X } from "lucide-react";
import { Input, cn } from "@eins/ui";
import { fold } from "@/lib/search/match";
import { CONTROL, DashCard, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { FAQ_CATEGORIES, type FaqCategory, type FaqItem } from "../content";
import { HilfeHead, QUESTION_BOX, SEARCH_SLOT, STACK } from "./parts";

/**
 * Umlauts typed without the e: "loschen" finds "löschen" as "loeschen"
 * does through `fold`.
 */
function plain(text: string): string {
  return text.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Question, answer and keywords of every item, folded both ways once. */
const HAYSTACKS = new Map(
  FAQ_CATEGORIES.flatMap((cat) => cat.items).map((item) => {
    const text = [item.q, item.a, ...(item.keywords ?? [])].join(" ");
    return [item.id, { folded: fold(text), plain: plain(text) }] as const;
  })
);

/** Only the items that contain the term; topics without one drop out. */
function filterCategories(term: string): FaqCategory[] {
  if (!term) return FAQ_CATEGORIES;
  const folded = fold(term);
  const bare = plain(term);
  const hit = (item: FaqItem) => {
    const h = HAYSTACKS.get(item.id);
    return !!h && (h.folded.includes(folded) || h.plain.includes(bare));
  };
  return FAQ_CATEGORIES.map((cat) => ({ ...cat, items: cat.items.filter(hit) })).filter(
    (cat) => cat.items.length > 0
  );
}

const NO_IDS: ReadonlySet<string> = new Set();

function flip(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Hilfe: the head with the search, then one card per topic with its
 * questions (Intercom's collection page).
 *
 * - Search (Help Scout's saved-reply filter): filters in the browser as you
 *   type, over question, answer and keywords, umlauts folded. Every hit is
 *   open, a tap closes it for this search; topics without a hit drop out.
 *   The FAQ is left out of the global ⌘K index, so this is the only search.
 * - Questions (GOV.UK's accordion): a tap opens the answer in place and
 *   pushes the questions below, like a help centre. One column, so nothing
 *   beside it changes size (DESIGN.md section 10).
 */
export function FaqBrowser() {
  const [query, setQuery] = useState("");
  const term = query.trim();
  const shown = useMemo(() => filterCategories(term), [term]);
  const hits = shown.reduce((sum, cat) => sum + cat.items.length, 0);

  // Questions opened by tap. While searching every hit is open; the ones
  // closed by tap count for that search only.
  const [opened, setOpened] = useState<ReadonlySet<string>>(NO_IDS);
  const [closed, setClosed] = useState({ term: "", ids: NO_IDS });
  const closedNow = closed.term === term ? closed.ids : NO_IDS;
  const isOpen = (id: string) => (term ? !closedNow.has(id) : opened.has(id));
  const toggle = (id: string) => {
    if (term) setClosed({ term, ids: flip(closedNow, id) });
    else setOpened((ids) => flip(ids, id));
  };

  return (
    <>
      {/* The hits are on screen; only screen readers hear how many. */}
      <p role="status" className="sr-only">
        {term
          ? hits === 0
            ? "Keine passenden Fragen gefunden."
            : `${hits} ${hits === 1 ? "Frage" : "Fragen"} gefunden.`
          : ""}
      </p>
      <div className={STACK}>
        <HilfeHead search={<SearchField value={query} onChange={setQuery} />} />

        {shown.length === 0 ? (
          // Intercom's empty search: one sentence with the word, then the way on.
          <DashCard bodyClassName="pt-5 md:pt-6">
            <p className="text-[15px] leading-6 text-fg-primary">
              Zu „{term}“ haben wir nichts gefunden. Schreiben Sie uns unter{" "}
              <Link
                href="/support"
                className="rounded-[var(--r-small)] font-medium underline decoration-fg-tertiary underline-offset-4 hover:decoration-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Nachrichten an EINS
              </Link>
              .
            </p>
          </DashCard>
        ) : (
          shown.map((cat) => (
            <DashCard key={cat.id} title={cat.label}>
              <ul className="divide-y divide-border">
                {cat.items.map((item) => (
                  <Question key={item.id} item={item} open={isOpen(item.id)} onToggle={() => toggle(item.id)} />
                ))}
              </ul>
            </DashCard>
          ))
        )}
      </div>
    </>
  );
}

/** Anfragen's search field: pressed into the canvas, X to clear. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className={SEARCH_SLOT}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
        aria-hidden
      />
      <Input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Fragen durchsuchen"
        aria-label="Fragen durchsuchen"
        className={cn(
          CONTROL,
          "elev-inset border-0 bg-[var(--surface-inset)] pl-10 pr-10 text-[15px] focus:bg-[var(--surface-tile)]"
        )}
      />
      <div className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
        {value ? (
          <button
            type="button"
            aria-label="Suche zurücksetzen"
            onClick={() => onChange("")}
            className="rounded-full p-0.5 text-fg-tertiary transition hover:bg-[var(--hover-wash)] hover:text-fg-primary"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The open question is marked whole, question and answer in one wash
 * (Fortschritt's open step). The wash reaches 12 px past the text on every
 * side and stops 4 px short of the hairlines (`WASH_ROW`, `WASH_AREA`), so
 * two open questions never touch.
 */
function Question({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  const panelId = `${item.id}-antwort`;
  return (
    <li className={WASH_ROW}>
      <div
        className={cn(
          WASH_AREA,
          "transition-colors",
          open ? "rounded-[var(--r-panel)] bg-[var(--hover-wash)]" : "rounded-[var(--r-control)] hover:bg-[var(--hover-wash)]"
        )}
      >
        <h3>
          <button
            type="button"
            id={`${item.id}-frage`}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className={cn(
              "-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-[var(--r-control)] px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              QUESTION_BOX
            )}
          >
            {/* Long questions wrap, never cut. */}
            <span className="min-w-0 flex-1 break-words text-[15px] font-medium leading-5 text-fg-primary">{item.q}</span>
            <ChevronDown
              aria-hidden
              className={cn("h-4 w-4 shrink-0 text-fg-tertiary transition-transform", open && "rotate-180")}
            />
          </button>
        </h3>
        {open && (
          // Plain dark text at body size, paragraphs kept, a reading measure at 1440.
          <div
            id={panelId}
            role="region"
            aria-labelledby={`${item.id}-frage`}
            className="-mt-1 max-w-[42rem] space-y-3 pb-3 text-[15px] leading-6 text-fg-primary"
          >
            {item.a.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
