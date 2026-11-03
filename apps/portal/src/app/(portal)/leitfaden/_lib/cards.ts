import type { Group, Section, SectionId } from "./sections";

/**
 * Sections as cards, shared by the view and `loading.tsx`. Imports only
 * types, so the browser never loads `content.ts` through it.
 */

/** One card on the page. The first card of a section carries its id (jumps, rail). */
export interface Card {
  key: string;
  id?: SectionId;
  title: string;
  groups: Group[];
}

/**
 * The cards of a section: one, or with `cardPerGroup` the unlabelled groups
 * under the section's title and then one card per labelled group, its label
 * as the card title (no band inside).
 */
export function cardsOf(s: Section): Card[] {
  if (!s.cardPerGroup) return [{ key: s.id, id: s.id, title: s.title, groups: s.groups }];
  const lead = s.groups.filter((g) => !g.label);
  const cards: Card[] = [
    ...(lead.length ? [{ key: s.id, title: s.title, groups: lead }] : []),
    ...s.groups
      .filter((g) => g.label)
      .map((g) => ({ key: `${s.id}-${g.id}`, title: g.label ?? "", groups: [{ ...g, label: undefined }] })),
  ];
  if (cards[0]) cards[0] = { ...cards[0], id: s.id };
  return cards;
}
