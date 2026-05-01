import { getEmailSender } from "@/server/email";

export interface EmailSendJob {
  to: string;
  subject: string;
  text: string;
  /** Optional — plaintext is wrapped in a minimal <pre> block if omitted. */
  html?: string;
}

/**
 * Async email send. Same shape as `enqueueEmail`. Failures bubble so BullMQ
 * retries (exponential backoff).
 */
export async function processEmailSend(job: EmailSendJob): Promise<void> {
  await getEmailSender().send({
    to: job.to,
    subject: job.subject,
    text: job.text,
    html:
      job.html ??
      `<pre style="font-family: -apple-system, Helvetica, Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(job.text)}</pre>`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
