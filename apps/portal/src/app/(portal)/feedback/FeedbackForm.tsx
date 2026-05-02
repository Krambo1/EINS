"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  Button,
  Label,
  Textarea,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eins/ui";
import { CheckCircle2, Send } from "lucide-react";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  type FeedbackCategory,
} from "@/lib/constants";
import { submitFeedbackAction, type SubmitFeedbackState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Send className="h-4 w-4" />
      {pending ? "Wird gesendet …" : "Feedback senden"}
    </Button>
  );
}

export function FeedbackForm() {
  const [state, formAction] = useActionState<SubmitFeedbackState | undefined, FormData>(
    submitFeedbackAction,
    { kind: "idle" }
  );
  const [category, setCategory] = useState<FeedbackCategory>("verbesserung");
  const formRef = useRef<HTMLFormElement>(null);
  const pathname = usePathname();

  // Reset the form once the action reports success so the user can send a second one.
  useEffect(() => {
    if (state?.kind === "success") {
      formRef.current?.reset();
      setCategory("verbesserung");
    }
  }, [state?.kind]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="feedback-category">Worum geht es?</Label>
        <Select
          name="category"
          value={category}
          onValueChange={(v) => setCategory(v as FeedbackCategory)}
        >
          <SelectTrigger id="feedback-category" className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FEEDBACK_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {FEEDBACK_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="feedback-message">Ihre Nachricht</Label>
        <Textarea
          id="feedback-message"
          name="message"
          rows={7}
          required
          minLength={5}
          maxLength={4000}
          placeholder={placeholderFor(category)}
        />
        <p className="text-xs text-fg-secondary">
          Je konkreter, desto besser. Wenn es um eine bestimmte Stelle im Portal
          geht, fügen Sie gerne den Link unten ein.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="feedback-pageUrl">Bezogen auf welche Seite? (optional)</Label>
        <Input
          id="feedback-pageUrl"
          name="pageUrl"
          type="text"
          maxLength={500}
          defaultValue={pathname && pathname !== "/feedback" ? pathname : ""}
          placeholder="/dashboard, /anfragen, …"
          className="max-w-md"
        />
      </div>

      {state?.kind === "error" && (
        <div className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
          {state.message}
        </div>
      )}

      {state?.kind === "success" && (
        <div className="flex items-start gap-3 rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] p-3 text-sm text-tone-good">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong>Vielen Dank.</strong> Ihr Feedback ist bei uns eingegangen.
            Wir melden uns, falls wir Rückfragen haben.
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-fg-secondary">
          Ihr Feedback geht direkt an die Geschäftsführung.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}

function placeholderFor(category: FeedbackCategory): string {
  switch (category) {
    case "verbesserung":
      return "Was sollte das Portal besser machen? Was fehlt Ihnen?";
    case "fehler":
      return "Was hat nicht funktioniert? Welche Schritte führen zum Fehler?";
    case "lob":
      return "Was hat Ihnen besonders gefallen?";
    case "frage":
      return "Was möchten Sie wissen?";
    case "sonstiges":
      return "Schreiben Sie uns einfach …";
  }
}
