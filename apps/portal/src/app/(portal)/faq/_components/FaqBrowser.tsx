"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Input,
} from "@eins/ui";
import { fold } from "@/lib/search/match";
import { FAQ_CATEGORIES } from "../content";

/**
 * Local, self-contained FAQ search + browser.
 *
 * This is deliberately independent of the global search palette (⌘K): the FAQ
 * is exempt from the global index, so this is the ONLY way to search it. It
 * filters purely client-side over the static `FAQ_CATEGORIES` list, folding
 * umlauts (via the shared `fold` helper) so users don't have to type ä/ö/ü.
 *
 * Behaviour:
 *   - no query  → every category shown, all answers collapsed.
 *   - query     → only matching questions shown, each auto-expanded so the
 *                 answer is visible immediately; empty categories drop out.
 */
export function FaqBrowser() {
  const [query, setQuery] = useState("");
  const term = query.trim();
  const hasQuery = term.length > 0;
  const folded = fold(term);

  // Filter categories → only keep items whose question, answer or keywords
  // contain the (folded) search term. Categories with no surviving item drop.
  const filtered = useMemo(() => {
    if (!hasQuery) return FAQ_CATEGORIES;
    return FAQ_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter((item) => {
        const haystack = fold(
          [item.q, item.a, ...(item.keywords ?? [])].join(" ")
        );
        return haystack.includes(folded);
      }),
    })).filter((cat) => cat.items.length > 0);
  }, [hasQuery, folded]);

  const resultCount = useMemo(
    () => filtered.reduce((sum, cat) => sum + cat.items.length, 0),
    [filtered]
  );

  // While searching, every surviving item is force-opened so answers are
  // visible without an extra click. The accordion key is reset per query so
  // it re-mounts with the new open set rather than keeping stale state.
  const openIds = hasQuery
    ? filtered.flatMap((cat) => cat.items.map((i) => i.id))
    : [];

  return (
    <div className="space-y-6">
      {/* Local search bar — separate from the global ⌘K palette. */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-tertiary"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Fragen durchsuchen, zum Beispiel Anfragen, Bewertungen, Datenschutz…"
          aria-label="Häufige Fragen durchsuchen"
          className="pl-12 pr-12"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Suche zurücksetzen"
            className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {hasQuery && (
        <p className="text-sm text-fg-secondary" aria-live="polite">
          {resultCount === 0
            ? "Keine passenden Fragen gefunden."
            : `${resultCount} ${resultCount === 1 ? "Frage" : "Fragen"} gefunden.`}
        </p>
      )}

      {resultCount === 0 && hasQuery ? (
        <div className="rounded-2xl border border-border bg-bg-secondary p-6 text-center">
          <p className="text-base text-fg-primary">
            Zu „{term}“ haben wir nichts gefunden.
          </p>
          <p className="mt-1 text-sm text-fg-secondary">
            Versuchen Sie ein anderes Stichwort. Ihre Frage ist nicht dabei?
            Schreiben Sie uns über den Bereich Feedback, wir helfen gerne weiter.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {filtered.map((cat) => (
            <section key={cat.id} className="scroll-mt-24">
              <h2 className="mb-3 text-sm font-semibold text-fg-secondary">
                {cat.label}
              </h2>
              <Accordion
                // Re-mount per query so the forced-open set applies cleanly.
                key={hasQuery ? `q-${folded}` : "idle"}
                type="multiple"
                defaultValue={openIds}
                className="space-y-2"
              >
                {cat.items.map((item) => (
                  <AccordionItem
                    key={item.id}
                    value={item.id}
                    className="rounded-xl border border-border px-4"
                  >
                    <AccordionTrigger className="text-base font-semibold text-fg-primary">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="whitespace-pre-line pb-4 text-base text-fg-primary">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
