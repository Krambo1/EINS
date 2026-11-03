import { z } from "zod";
import {
  REPLY_BUCKET_ORDER,
  allReplyTemplates,
  standardReplyTemplate,
  type ReplyTemplate,
} from "./reply-templates";

/**
 * What a Praxis changed in its Antwortvorlagen, stored on
 * `clinics.reply_templates` (migration 0106): new words for a standard
 * template, by its id, and templates of its own. The standard ones are never
 * stored, so a later change to a shipped text reaches every Praxis that left
 * it alone, and "Original wiederherstellen" only drops the entry.
 */

export const TEMPLATE_TITLE_MAX = 80;
export const TEMPLATE_TEXT_MAX = 2000;
/** Own templates per Praxis. */
export const CUSTOM_TEMPLATES_MAX = 30;

const TitleSchema = z.string().trim().min(1, "Bitte geben Sie einen Titel ein.").max(TEMPLATE_TITLE_MAX);
const TextSchema = z.string().trim().min(1, "Bitte geben Sie einen Text ein.").max(TEMPLATE_TEXT_MAX);
export const CustomTemplateIdSchema = z.string().regex(/^eigene-[a-z0-9-]{8,64}$/);
const BucketSchema = z.enum(REPLY_BUCKET_ORDER as [string, ...string[]]).transform(
  (b) => b as ReplyTemplate["bucket"]
);

export const StoredReplyTemplatesSchema = z.object({
  edited: z.record(z.string(), z.object({ title: TitleSchema, text: TextSchema })).default({}),
  custom: z
    .array(
      z.object({ id: CustomTemplateIdSchema, bucket: BucketSchema, title: TitleSchema, text: TextSchema })
    )
    .max(CUSTOM_TEMPLATES_MAX)
    .default([]),
});

export type StoredReplyTemplates = z.infer<typeof StoredReplyTemplatesSchema>;

/** One change from the card (`updateReplyTemplatesAction`). */
export const ReplyTemplateOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("save"),
    id: z.string().min(1).max(80),
    bucket: BucketSchema,
    title: TitleSchema,
    text: TextSchema,
  }),
  z.object({ op: z.literal("reset"), id: z.string().min(1).max(80) }),
  z.object({ op: z.literal("delete"), id: CustomTemplateIdSchema }),
]);

export type ReplyTemplateOp = z.input<typeof ReplyTemplateOpSchema>;

/** The stored column, or nothing changed when it is empty or does not parse. */
export function parseStoredReplyTemplates(raw: unknown): StoredReplyTemplates {
  const parsed = StoredReplyTemplatesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { edited: {}, custom: [] };
}

/**
 * The templates a Praxis sees: the standard ones (with its words where it
 * changed them), its own after them, each group in display order.
 */
export function mergeReplyTemplates(raw: unknown): ReplyTemplate[] {
  const stored = parseStoredReplyTemplates(raw);
  const standard = allReplyTemplates().map((t): ReplyTemplate => {
    const edit = stored.edited[t.id];
    return edit ? { ...t, ...edit, origin: "edited" } : { ...t, origin: "standard" };
  });
  const custom = stored.custom.map((t): ReplyTemplate => ({ ...t, origin: "custom" }));
  return REPLY_BUCKET_ORDER.flatMap((b) => [
    ...standard.filter((t) => t.bucket === b),
    ...custom.filter((t) => t.bucket === b),
  ]);
}

/** Applies one change; a plain Error carries a message the card shows as is. */
export function applyReplyTemplateOp(
  current: StoredReplyTemplates,
  op: z.output<typeof ReplyTemplateOpSchema>
): StoredReplyTemplates {
  const edited = { ...current.edited };
  let custom = [...current.custom];
  const standard = standardReplyTemplate(op.id);

  if (op.op === "save") {
    if (standard) {
      // Saving the shipped words again is the same as leaving it alone.
      if (op.title === standard.title && op.text === standard.text) delete edited[op.id];
      else edited[op.id] = { title: op.title, text: op.text };
    } else {
      if (!CustomTemplateIdSchema.safeParse(op.id).success) throw new Error("Unbekannte Vorlage.");
      const at = custom.findIndex((t) => t.id === op.id);
      const next = { id: op.id, bucket: op.bucket, title: op.title, text: op.text };
      if (at >= 0) custom[at] = next;
      else if (custom.length >= CUSTOM_TEMPLATES_MAX)
        throw new Error(`Höchstens ${CUSTOM_TEMPLATES_MAX} eigene Vorlagen.`);
      else custom.push(next);
    }
  } else if (op.op === "reset") {
    delete edited[op.id];
  } else {
    custom = custom.filter((t) => t.id !== op.id);
  }
  return { edited, custom };
}
