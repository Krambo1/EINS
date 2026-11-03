import { fold } from "@/lib/search/match";
import {
  ANFRAGE_CADENCE,
  ANFRAGE_CHANNELS,
  ANFRAGE_TEMPLATES,
  ANFRAGE_WHATSAPP_RULE,
  CLOSE_STEPS,
  DISCOVERY_BLOCKS,
  HWG_TABLES,
  LEITFADEN_PAGE as L,
  NO_SHOW_TEMPLATES,
  OBJECTION_GROUPS,
  OBJECTIONS,
  OPENING_SCRIPTS,
  type AnfrageChannel,
  type CadenceRow,
} from "../content";

/**
 * The page `/leitfaden` as data: five sections of rows, built from the `core`
 * items of `content.ts` (the PDF renders all of them). Read on the server and
 * passed to the client view, so the browser never loads the full playbook.
 * `loading.tsx` counts the same rows for its skeleton.
 *
 * Left out of the page on purpose (they stay in the PDF): the intros, the
 * rules of "Anfragen beantworten" but the WhatsApp one, the notes under the
 * Eröffnungen (why a script works), and the "Eigentliche Sorge" of each
 * Einwand (Klue's card: objection, then the answer).
 */

/** What an opened row shows, in order. */
export type Block =
  /** A line of context above a script ("Patient: „…“"). */
  | { kind: "line"; text: string }
  /** Text to say or send, with "Kopieren" (Vercel's code block). */
  | { kind: "well"; label: string; text: string }
  /** A hint for the team, outside the well. */
  | { kind: "note"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  /** Phrases to avoid under an Einwand (Shopify's Don't). */
  | { kind: "avoid"; items: string[] }
  /** Sag so, nicht so (Shopify's Do/Don't pair). */
  | { kind: "pairs"; rows: { good: string; bad: string }[] }
  | { kind: "cadence"; rows: CadenceRow[] };

export interface Item {
  id: string;
  title: string;
  /** GOV.UK's warning mark before the title. */
  warning?: boolean;
  body: Block[];
  /** Everything in the row, folded (umlauts, case) for the search. */
  haystack: string;
}

export interface Group {
  id: string;
  /** Group head; the first group of a section may have none. */
  label?: string;
  /** A rule shown under the group head, always open (GOV.UK warning text). */
  warning?: string;
  items: Item[];
}

export type SectionId = "anfragen" | "gespraech" | "einwaende" | "termin" | "sag-so";

export interface Section {
  id: SectionId;
  title: string;
  groups: Group[];
  /** Each labelled group in a card of its own, titled by its label (Karam, 2026-10-30: Telefon, E-Mail, WhatsApp apart). */
  cardPerGroup?: boolean;
}

function blockText(b: Block): string[] {
  switch (b.kind) {
    case "line":
    case "well":
    case "note":
      return [b.text];
    case "list":
    case "avoid":
      return b.items;
    case "pairs":
      return b.rows.flatMap((r) => [r.good, r.bad]);
    case "cadence":
      return b.rows.flatMap((r) => [r.time, r.channel, r.purpose]);
  }
}

/**
 * "A1. „Das ist mir zu teuer.“" → "„Das ist mir zu teuer.“", "C. Zeitpunkt-
 * Einwände" → "Zeitpunkt-Einwände": the numbers count the PDF's full lists,
 * so on the page, which shows a few of them, they would only show gaps.
 */
function withoutPdfNumber(title: string): string {
  return title.replace(/^(?:[A-Z]\d*|\d+)\.\s+/, "");
}

function item(id: string, title: string, body: Block[], warning?: boolean): Item {
  const shown = withoutPdfNumber(title);
  return { id, title: shown, warning, body, haystack: fold([shown, ...body.flatMap(blockText)].join(" ")) };
}

/**
 * A template as wells: an e-mail's "Betreff: …" line becomes a well of its
 * own, so subject and text are copied into their own fields.
 */
function templateBlocks(text: string, label: string): Block[] {
  const m = /^Betreff: (.*)\n\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return [{ kind: "well", label, text }];
  return [
    { kind: "well", label: L.wells.subject, text: m[1] },
    { kind: "well", label: L.wells.text, text: m[2] },
  ];
}

function anfrageItems(channel: AnfrageChannel): Item[] {
  // A call is spoken, an e-mail or WhatsApp is sent.
  const label = channel === "telefon" ? L.wells.say : L.wells.text;
  return ANFRAGE_TEMPLATES.filter((t) => t.core && t.channel === channel).map((t) =>
    item(`vorlage-${t.id}`, t.title, [
      ...templateBlocks(t.text, label),
      ...(t.note ? [{ kind: "note", text: t.note } as const] : []),
    ])
  );
}

export const SECTIONS: Section[] = [
  {
    id: "anfragen",
    title: L.sections.anfragen,
    cardPerGroup: true,
    groups: [
      { id: "ablauf", items: [item("ablauf", L.cadence, [{ kind: "cadence", rows: ANFRAGE_CADENCE }])] },
      ...ANFRAGE_CHANNELS.map((c) => ({
        id: c.id,
        label: c.label,
        warning: c.id === "whatsapp" ? ANFRAGE_WHATSAPP_RULE : undefined,
        items: anfrageItems(c.id),
      })),
    ],
  },
  {
    id: "gespraech",
    title: L.sections.gespraech,
    groups: [
      {
        id: "gespraech",
        items: [
          ...OPENING_SCRIPTS.filter((s) => s.core).map((s) =>
            item(`eroeffnung-${s.id}`, s.title, [
              ...(s.patientLine ? [{ kind: "line", text: s.patientLine } as const] : []),
              { kind: "well", label: L.wells.say, text: s.quote },
            ])
          ),
          ...DISCOVERY_BLOCKS.filter((b) => b.core).map((b) =>
            item(
              `bedarf-${b.id}`,
              b.pageTitle ?? b.title,
              [
                { kind: "list", ordered: b.list === "ol", items: b.items },
                ...(b.note ? [{ kind: "note", text: b.note } as const] : []),
              ],
              b.id === "d-rote-flaggen"
            )
          ),
        ],
      },
    ],
  },
  {
    id: "einwaende",
    title: L.sections.einwaende,
    groups: OBJECTION_GROUPS.map((g) => ({
      id: g.id,
      label: withoutPdfNumber(g.label),
      items: OBJECTIONS.filter((o) => o.core && o.group === g.id).map((o) =>
        item(`einwand-${o.id}`, o.title, [
          { kind: "well", label: L.wells.answer, text: o.answer },
          { kind: "avoid", items: o.avoid },
        ])
      ),
    })).filter((g) => g.items.length > 0),
  },
  {
    id: "termin",
    title: L.sections.termin,
    groups: [
      {
        id: "termin",
        items: [
          ...CLOSE_STEPS.filter((s) => s.core).map((s) =>
            item(`termin-${s.id}`, s.title, [
              ...(s.quote ? [{ kind: "well", label: L.wells.say, text: s.quote } as const] : []),
              ...(s.list ? [{ kind: "list", ordered: true, items: s.list } as const] : []),
              ...(s.note ? [{ kind: "note", text: s.note } as const] : []),
            ])
          ),
          ...NO_SHOW_TEMPLATES.filter((t) => t.core).map((t) =>
            item(`erinnerung-${t.id}`, t.title, templateBlocks(t.text, L.wells.text))
          ),
        ],
      },
    ],
  },
  {
    id: "sag-so",
    title: L.sections.sagSo,
    groups: [
      {
        id: "sag-so",
        items: HWG_TABLES.filter((t) => t.core).map((t) =>
          item(`sag-so-${t.id}`, t.title, [
            { kind: "pairs", rows: t.rows.map(([bad, good]) => ({ good, bad })) },
          ])
        ),
      },
    ],
  },
];
