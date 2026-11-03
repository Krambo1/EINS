"use client";

import { useActionState, useEffect, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Button, cn } from "@eins/ui";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { showActionFlash } from "../../_components/flash-event";
import { CardBody, CardFoot, Field, PRIMARY_BUTTON, TextInput } from "../../einstellungen/_components/settings-ui";
import { sendSupport } from "../actions";
import { KI_NOTE, PRIVACY_NOTE } from "../_lib/labels";
import { MESSAGE_HEIGHT, TEXT_AREA } from "../_lib/sizes";

const CARD = "anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]";

type SendState = Awaited<ReturnType<typeof sendSupport>>;

/** `sendSupport`, with a lost connection as an error for the toast instead of the error page. */
async function send(prev: SendState, form: FormData): Promise<SendState> {
  try {
    return (await sendSupport(prev, form)) ?? prev;
  } catch (err) {
    unstable_rethrow(err);
    return { error: "Keine Verbindung. Ihr Text bleibt stehen, bitte senden Sie gleich noch einmal." };
  }
}

/**
 * A new conversation, one card of fixed height (Help Scout's Beacon "Ask",
 * Zendesk's request form): Betreff and Nachricht, the one hint under the
 * text, who answers in the foot beside "Senden" (Einstellungen' card foot).
 * While it sends, the fields and the button grey out; an error goes to the
 * toast and the text stays; once sent, the conversation opens.
 */
export function NewMessageForm({ nonce }: { nonce: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(send, { error: "" });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // One id per message: a second tap or a retry after a lost answer is not sent twice.
  const [submissionId, setSubmissionId] = useState(nonce);

  useEffect(() => {
    if (state.caseId) {
      setSubject("");
      setBody("");
      setSubmissionId(crypto.randomUUID());
      router.push(`/support/${state.caseId}`);
      router.refresh();
    } else if (state.error) {
      showActionFlash({ tone: "bad", title: "Nachricht nicht gesendet", description: state.error });
    }
  }, [state, router]);

  return (
    <form action={action} aria-label="Neue Nachricht" className={CARD}>
      <input type="hidden" name="nonce" value={submissionId} />
      <CardBody className="space-y-5 pt-5 md:pt-6">
        <Field label="Betreff" htmlFor="support-subject">
          <TextInput
            id="support-subject"
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            minLength={2}
            maxLength={140}
            autoComplete="off"
            disabled={pending}
          />
        </Field>
        <Field label="Nachricht" htmlFor="support-body">
          <ScrollHint watch={body}>
            <textarea
              id="support-body"
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              minLength={2}
              maxLength={12000}
              disabled={pending}
              aria-describedby="support-body-hint"
              className={cn(TEXT_AREA, MESSAGE_HEIGHT)}
            />
          </ScrollHint>
          <p id="support-body-hint" className="mt-1.5 text-sm leading-5 text-fg-secondary">
            {PRIVACY_NOTE}
          </p>
        </Field>
      </CardBody>
      <CardFoot start={<p className="text-sm leading-5 text-fg-secondary">{KI_NOTE}</p>}>
        <Button type="submit" disabled={pending || body.trim().length < 2} aria-busy={pending} className={PRIMARY_BUTTON}>
          Senden
        </Button>
      </CardFoot>
    </form>
  );
}
