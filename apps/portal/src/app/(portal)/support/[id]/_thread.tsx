"use client";

import { useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Button, cn } from "@eins/ui";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { formatDateTime } from "@/lib/formatting";
import { showActionFlash } from "../../_components/flash-event";
import { PRIMARY_BUTTON } from "../../einstellungen/_components/settings-ui";
import { sendSupport } from "../actions";
import { IMPERSONATION_NOTE, PRIVACY_NOTE, senderLabel } from "../_lib/labels";
import { REPLY_HEIGHT, TEXT_AREA, THREAD_CARD } from "../_lib/sizes";

export type ThreadMessage = {
  id: string;
  direction: string;
  body: string;
  receivedAt: string;
  /** Sent from this page and not yet confirmed: shown faded. */
  pending?: boolean;
};

/** How close to the end the reader still counts as at the newest message, in px. */
const AT_END = 48;

/**
 * The messages and the answer field of one conversation (Plain's thread:
 * name and time over each message, hairlines between them, the composer
 * behind a hairline at the card's foot). The card keeps its height: the
 * messages scroll, the field stays where it is.
 *
 * An answer shows at once, faded, under the last message (useOptimistic)
 * and the field empties. If it fails, it is taken back, its text returns to
 * the field and the toast names the problem. The id of the answer (`nonce`)
 * stays until it went through, so a retry after a lost answer is not sent
 * twice.
 */
export function Thread({
  caseId,
  subject,
  nonce: firstNonce,
  readOnly,
  messages,
}: {
  caseId: string;
  subject: string;
  nonce: string;
  /** In the Kundenansicht: no answer field, a sentence in its place. */
  readOnly: boolean;
  messages: ThreadMessage[];
}) {
  const router = useRouter();
  const listRef = useRef<HTMLOListElement>(null);
  const [text, setText] = useState("");
  const [nonce, setNonce] = useState(firstNonce);
  const [shown, addPending] = useOptimistic(messages, (state, m: ThreadMessage) => [...state, m]);
  const [sending, startSending] = useTransition();
  const busy = useRef(false);
  // Follow new messages only while the reader is at the newest one, or just sent one.
  const atEnd = useRef(true);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && atEnd.current) list.scrollTop = list.scrollHeight;
  }, [shown.length]);

  function send() {
    const body = text;
    if (busy.current || body.trim().length < 2) return;
    busy.current = true;
    atEnd.current = true;
    const form = new FormData();
    form.set("subject", subject);
    form.set("body", body);
    form.set("nonce", nonce);
    form.set("caseId", caseId);
    setText("");

    // Taken back: the text returns to the field, before what was typed since.
    const restore = () => setText((typed) => (typed.trim() ? `${body}\n\n${typed}` : body));

    startSending(async () => {
      addPending({ id: `pending-${nonce}`, direction: "inbound", body, receivedAt: new Date().toISOString(), pending: true });
      try {
        const res = await sendSupport(undefined, form);
        if (res?.caseId) {
          setNonce(crypto.randomUUID());
          router.refresh();
        } else {
          restore();
          // No answer at all: the session ended and the page moves to the login.
          if (res?.error) showActionFlash({ tone: "bad", title: "Nachricht nicht gesendet", description: res.error });
        }
      } catch (err) {
        unstable_rethrow(err);
        restore();
        showActionFlash({
          tone: "bad",
          title: "Keine Verbindung",
          description: "Ihre Nachricht wurde nicht gesendet. Sie steht wieder im Feld.",
        });
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <section aria-label="Unterhaltung" className={THREAD_CARD}>
      <ol
        ref={listRef}
        tabIndex={0}
        aria-label="Nachrichten"
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.clientHeight - el.scrollTop <= AT_END;
        }}
        className="scroll-shadows min-h-0 flex-1 divide-y divide-border px-5 py-1 [--scroll-bg:var(--surface-tile)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent md:px-6 md:py-2"
      >
        {shown.map((m) => (
          <li key={m.id} aria-busy={m.pending || undefined} className={cn("py-4 transition-opacity", m.pending && "opacity-60")}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-semibold leading-6 text-fg-primary">{senderLabel(m.direction)}</span>
              <time dateTime={m.receivedAt} className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary">
                {formatDateTime(m.receivedAt)}
              </time>
            </div>
            {/* Long words and links wrap, never cut. */}
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-fg-primary">{m.body}</p>
          </li>
        ))}
      </ol>

      {readOnly ? (
        <p className="border-t border-border px-5 py-4 text-sm leading-5 text-fg-secondary md:px-6">{IMPERSONATION_NOTE}</p>
      ) : (
        <form
          aria-label="Antworten"
          className="border-t border-border px-5 py-4 md:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <ScrollHint watch={text}>
            <textarea
              name="body"
              aria-label="Antwort"
              aria-describedby="support-reply-hint"
              placeholder="Antwort schreiben"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              maxLength={12000}
              className={cn(TEXT_AREA, REPLY_HEIGHT)}
            />
          </ScrollHint>
          <div className="mt-3 flex items-start justify-between gap-3">
            <p id="support-reply-hint" className="flex min-h-[var(--control-h)] min-w-0 items-center text-sm leading-5 text-fg-secondary">
              {PRIVACY_NOTE}
            </p>
            <Button
              type="submit"
              disabled={sending || text.trim().length < 2}
              title="Strg+Enter"
              className={cn(PRIMARY_BUTTON, "shrink-0")}
            >
              Senden
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
