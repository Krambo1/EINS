import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@eins/ui";
import { DashCard } from "../../dashboard/_components/dash-ui";
import { StatusWord, type OnboardingStatus } from "../_components/StatusWord";
import { ITEM_TITLE, JUMP_SCROLL, ROW_LIST, SKELETON_BAR } from "../_lib/sizes";
import {
  ABSCHLUSS_HINWEIS,
  MESSWEGE_HINWEIS,
  isClosed,
  isDelivered,
  type ChecklistBlock,
  type ChecklistItem,
  type ChecklistStatus,
} from "./content";

/**
 * Frame parts of the Checkliste, drawn by the page and its skeleton alike, so
 * both have the same heights (DESIGN.md section 10).
 */

export const blockAnchorId = (key: string) => `block-${key}`;

/** The four status words: "geliefert" is the Praxis's part done. */
export function itemStatus(status: ChecklistStatus): OnboardingStatus {
  return status === "geliefert" ? "erledigt" : status;
}

/**
 * A block is "Erledigt" once all its Pflichtpunkte are delivered and
 * "Geprüft" once EINS has checked all of them; optional items never hold a
 * block open.
 */
export function blockStatus(block: ChecklistBlock, statusOf: (id: string) => ChecklistStatus | undefined): OnboardingStatus {
  const required = block.items.filter((i) => i.required);
  if (required.every((i) => isClosed(statusOf(i.id)))) return "geprueft";
  if (required.every((i) => isDelivered(statusOf(i.id)))) return "erledigt";
  return "offen";
}

/**
 * One block (Stripe's hosted onboarding sections, as the Fragebogen): the
 * title, its status at the right of the head, the block's standing note,
 * then the items as rows with hairlines between.
 */
export function BlockCard({
  block,
  status,
  children,
}: {
  block: ChecklistBlock;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashCard
      id={blockAnchorId(block.key)}
      // The title wraps instead of being cut (DashCard truncates a plain title).
      title={<span className="whitespace-normal">{block.title}</span>}
      // One box for the status word and the skeleton's bar.
      action={<span className="flex h-6 items-center">{status}</span>}
      className={JUMP_SCROLL}
      bodyClassName="pb-3 pt-4 md:pb-4"
    >
      {block.intro && <p className="mb-3 max-w-3xl text-[15px] leading-6 text-fg-primary">{block.intro}</p>}
      <ul className={cn(ROW_LIST, block.intro && "border-t border-border")}>{children}</ul>
    </DashCard>
  );
}

/**
 * What a row shows: the title (two lines below lg, one from lg) and one meta
 * line, the status first, then "Inhaber" where only the Inhaber may close
 * the item, "Optional" or "Empfohlen", and the files once there are some.
 * `meta` null draws the skeleton's bar instead.
 */
export function ItemRowContent({
  item,
  meta,
  open = false,
}: {
  item: ChecklistItem;
  meta: { status: ChecklistStatus; files: number } | null;
  open?: boolean;
}) {
  const facts = meta
    ? [
        item.role === "inhaber" ? "Inhaber" : null,
        item.required ? null : item.recommended ? "Empfohlen" : "Optional",
        meta.files > 0 ? (meta.files === 1 ? "1 Datei" : `${meta.files} Dateien`) : null,
      ].filter((f): f is string => f != null)
    : [];
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className={ITEM_TITLE}>{item.title}</span>
        <span className="mt-1 flex h-5 min-w-0 items-center gap-2 text-sm leading-5 text-fg-secondary">
          {meta ? (
            <>
              <StatusWord status={itemStatus(meta.status)} />
              {facts.map((f) => (
                <span key={f} className="contents">
                  <span aria-hidden>·</span>
                  <span className="min-w-0 truncate tabular-nums">{f}</span>
                </span>
              ))}
            </>
          ) : (
            <span className={cn(SKELETON_BAR, "h-3.5 w-32")} />
          )}
        </span>
      </span>
      <ChevronDown
        aria-hidden
        className={cn("h-5 w-5 shrink-0 text-fg-tertiary transition-transform", open && "rotate-180")}
      />
    </>
  );
}

/**
 * "Was danach zählt": no delivery, the Praxis's part during the work. The
 * points as hairline rows (GOV.UK's summary list), no mint bullets.
 */
export function AbschlussCard() {
  return (
    <DashCard title={ABSCHLUSS_HINWEIS.title} bodyClassName="pb-3 pt-4 md:pb-4">
      <p className="max-w-3xl text-[15px] leading-6 text-fg-primary">{ABSCHLUSS_HINWEIS.intro}</p>
      <ul className="mt-3 divide-y divide-border border-t border-border">
        {ABSCHLUSS_HINWEIS.points.map((p) => (
          <li key={p} className="max-w-3xl py-3 text-[15px] leading-6 text-fg-primary">
            {p}
          </li>
        ))}
      </ul>
    </DashCard>
  );
}

export interface MesswegeRows {
  numbers: { id: string; text: string }[];
  links: { id: string; url: string; label: string }[];
}

/**
 * The Praxis's tracking numbers and booking links (GOV.UK's summary list:
 * the label, then the values), or one sentence while EINS has set none up.
 * `rows` null draws the skeleton's bar.
 */
export function MesswegeCard({ rows }: { rows: MesswegeRows | null }) {
  const empty = rows != null && rows.numbers.length === 0 && rows.links.length === 0;
  return (
    <DashCard
      // The title wraps instead of being cut on the phone.
      title={<span className="whitespace-normal">{MESSWEGE_HINWEIS.title}</span>}
      bodyClassName="pb-3 pt-4 md:pb-4"
    >
      {rows == null ? (
        // As high as the sentence of a Praxis without Messwege, the usual
        // case during onboarding.
        <p className="relative max-w-3xl text-[15px] leading-6">
          <span className="invisible">{MESSWEGE_HINWEIS.empty}</span>
          <span aria-hidden className={cn(SKELETON_BAR, "absolute left-0 top-1 h-4 w-72 max-w-full")} />
        </p>
      ) : empty ? (
        <p className="max-w-3xl text-[15px] leading-6 text-fg-primary">{MESSWEGE_HINWEIS.empty}</p>
      ) : (
        <>
          <p className="max-w-3xl text-[15px] leading-6 text-fg-primary">{MESSWEGE_HINWEIS.intro}</p>
          <dl className="mt-3 divide-y divide-border border-t border-border">
            {rows.numbers.length > 0 && (
              <SummaryRow label={MESSWEGE_HINWEIS.numbersLabel}>
                {rows.numbers.map((n) => (
                  <li key={n.id} className="tabular-nums">
                    {n.text}
                  </li>
                ))}
              </SummaryRow>
            )}
            {rows.links.length > 0 && (
              <SummaryRow label={MESSWEGE_HINWEIS.linksLabel}>
                {rows.links.map((l) => (
                  <li key={l.id} className="min-w-0">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all underline underline-offset-4 hover:text-fg-secondary"
                    >
                      {l.url}
                    </a>
                    {" · "}
                    {l.label}
                  </li>
                ))}
              </SummaryRow>
            )}
          </dl>
        </>
      )}
    </DashCard>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6">
      <dt className="text-sm leading-5 text-fg-secondary md:leading-6">{label}</dt>
      <dd className="mt-1 text-[15px] leading-6 text-fg-primary md:mt-0">
        <ul className="space-y-1">{children}</ul>
      </dd>
    </div>
  );
}
