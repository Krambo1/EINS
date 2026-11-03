"use client";

import type { ReactNode } from "react";
import { cn } from "@eins/ui";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { DashCard } from "../../dashboard/_components/dash-ui";
import { FIELD } from "../../einstellungen/_lib/sizes";
import { JUMP_SCROLL, OPTION_INPUT, OPTION_ROW, QUESTION_STACK, TEXTAREA_HEIGHT } from "../_lib/sizes";
import { questionAnchorId, sectionAnchorId } from "./anchors";
import { formatBudgetEur, parseEuroAmount, type DiscoveryBlock, type DiscoveryQuestion } from "./content";


/**
 * Blocks B and C explain EINS's method in their "why" (nobody answers
 * differently because of it); block D's one sentence says why its questions
 * matter and stays at the top of its card. The texts stay in content.ts.
 */
const SHOWN_WHY = new Set(["D"]);

/**
 * One section of the Fragebogen (Stripe's hosted onboarding): the title, its
 * status at the right of the head, the questions with room between them.
 * The form and the skeleton both draw it, so they always match.
 */
export function SectionCard({
  block,
  status,
  children,
}: {
  block: DiscoveryBlock;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashCard
      id={sectionAnchorId(block.key)}
      // The title wraps instead of being cut (DashCard truncates a plain title).
      title={<span className="whitespace-normal">{block.title}</span>}
      // One box for the status word and the skeleton's bar.
      action={<span className="flex h-6 items-center">{status}</span>}
      className={JUMP_SCROLL}
      bodyClassName="pt-5"
    >
      {block.why && SHOWN_WHY.has(block.key) && (
        <p className="mb-6 max-w-3xl text-[15px] leading-6 text-fg-primary md:mb-7">{block.why}</p>
      )}
      <div className={QUESTION_STACK}>{children}</div>
    </DashCard>
  );
}

/**
 * One question: bold label, "Optional" after it on the optional ones only
 * (GOV.UK), the grey hint, then one control per type (GOV.UK's text input,
 * textarea, radios, checkboxes; the budget field with its suffix). A missing
 * answer shows GOV.UK's red bar in the card's margin, so nothing grows.
 * Without `onChange` it draws the empty, disabled frame of the skeleton.
 */
export function QuestionField({
  question: q,
  value,
  missing = false,
  onChange,
}: {
  question: DiscoveryQuestion;
  value?: string | string[];
  missing?: boolean;
  onChange?: (value: string | string[]) => void;
}) {
  const id = `discovery-${q.id}`;
  const labelId = `${id}-label`;
  const hintId = q.hint ? `${id}-hint` : undefined;
  const disabled = !onChange;
  const isGroup = q.type === "auswahl" || q.type === "mehrfach";
  const text = typeof value === "string" ? value : "";

  const label = (
    <>
      {q.label}
      {!q.required && <span className="ml-2 text-sm font-normal text-fg-secondary">Optional</span>}
      {missing && <span className="sr-only"> Bitte beantworten</span>}
    </>
  );
  const LABEL = "block text-[15px] font-semibold leading-6 text-fg-primary";

  return (
    <div id={questionAnchorId(q.id)} className={cn("relative", JUMP_SCROLL)}>
      {missing && <span aria-hidden className="absolute -left-4 bottom-0 top-0 w-1 rounded-full bg-tone-bad md:-left-5" />}
      {isGroup ? (
        <p id={labelId} className={LABEL}>
          {label}
        </p>
      ) : (
        <label id={labelId} htmlFor={id} className={LABEL}>
          {label}
        </label>
      )}
      {q.hint && (
        <p id={hintId} className="mt-0.5 text-sm leading-5 text-fg-secondary">
          {q.hint}
        </p>
      )}

      <div className="mt-3">
        {q.type === "text" && (
          <input
            id={id}
            type="text"
            maxLength={4000}
            value={text}
            disabled={disabled}
            onChange={(e) => onChange?.(e.target.value)}
            aria-describedby={hintId}
            aria-invalid={missing || undefined}
            className={FIELD}
          />
        )}

        {q.type === "textarea" && (
          <ScrollHint watch={value}>
            <textarea
              id={id}
              rows={4}
              maxLength={4000}
              value={text}
              disabled={disabled}
              onChange={(e) => onChange?.(e.target.value)}
              aria-describedby={hintId}
              aria-invalid={missing || undefined}
              className={cn(FIELD, TEXTAREA_HEIGHT)}
            />
          </ScrollHint>
        )}

        {q.type === "auswahl" && q.options && (
          <>
            <div role="radiogroup" aria-labelledby={labelId} aria-describedby={hintId} aria-invalid={missing || undefined}>
              {q.options.map((opt) => (
                <label key={opt} className={cn(OPTION_ROW, disabled && "cursor-default hover:bg-transparent")}>
                  <input
                    type="radio"
                    name={id}
                    value={opt}
                    checked={value === opt}
                    disabled={disabled}
                    onChange={() => onChange?.(opt)}
                    // A tap on the chosen option takes it back.
                    onClick={() => {
                      if (value === opt) onChange?.("");
                    }}
                    className={OPTION_INPUT}
                  />
                  <span className="min-w-0">{opt}</span>
                </label>
              ))}
            </div>
            {q.allowCustom && (
              <BudgetField
                question={q}
                inputId={`${id}-custom`}
                raw={q.options.includes(text) ? "" : text}
                disabled={disabled}
                onChange={(v) => onChange?.(v)}
              />
            )}
          </>
        )}

        {q.type === "mehrfach" && q.options && (
          // A group takes no aria-invalid; the label's "Bitte beantworten" says it.
          <div role="group" aria-labelledby={labelId} aria-describedby={hintId}>
            {q.options.map((opt) => {
              const current = Array.isArray(value) ? value : [];
              const selected = current.includes(opt);
              // At the cap the other options grey out (GOV.UK checkboxes, "Bis zu 3").
              const atCap = !selected && q.maxSelect != null && current.length >= q.maxSelect;
              return (
                <label
                  key={opt}
                  className={cn(OPTION_ROW, (disabled || atCap) && "cursor-default hover:bg-transparent", atCap && "opacity-50")}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled || atCap}
                    onChange={() => onChange?.(selected ? current.filter((v) => v !== opt) : [...current, opt])}
                    className={OPTION_INPUT}
                  />
                  <span className="min-w-0">{opt}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The own amount under the budget options (GOV.UK's input with a suffix):
 * typing here replaces the answer, which unchecks the options. The note
 * under it has one line of its own, empty or not, so nothing moves.
 */
function BudgetField({
  question: q,
  inputId,
  raw,
  disabled,
  onChange,
}: {
  question: DiscoveryQuestion;
  inputId: string;
  raw: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const note = budgetNoteFor(raw);
  return (
    <div className="mt-3">
      <label htmlFor={inputId} className="block text-sm font-medium leading-5 text-fg-primary">
        {q.customLabel ?? "Oder eigener Betrag"}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          maxLength={12}
          placeholder="z. B. 2.000"
          value={raw}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${inputId}-note`}
          className={cn(FIELD, "w-40")}
        />
        <span className="text-[15px] text-fg-secondary">€ pro Monat</span>
      </div>
      <p
        id={`${inputId}-note`}
        aria-live="polite"
        className={cn("mt-1.5 h-5 truncate text-sm leading-5", note?.tone === "bad" ? "text-tone-bad" : "text-fg-secondary")}
      >
        {note?.text}
      </p>
    </div>
  );
}

/** Live note for the own amount; null when the field is empty. */
function budgetNoteFor(raw: string): { tone: "bad" | "muted"; text: string } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const eur = parseEuroAmount(trimmed);
  if (eur === null) return { tone: "bad", text: "Bitte nur einen Betrag, zum Beispiel 2.000." };
  return { tone: "muted", text: `Geplant: ${formatBudgetEur(eur)} pro Monat.` };
}
