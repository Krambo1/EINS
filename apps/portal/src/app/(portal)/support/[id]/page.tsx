import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { z } from "zod";
import { cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { isImpersonating } from "@/auth/impersonation-guard";
import { supportConversation } from "@/server/support";
import { Status } from "../../einstellungen/_components/settings-ui";
import { SupportHead } from "../_components/SupportHead";
import { caseStatus } from "../_lib/labels";
import { PAGE_WIDTH, THREAD_PAGE_HEIGHT } from "../_lib/sizes";
import { Refresh } from "../Refresh";
import { Thread } from "./_thread";

export const metadata = { title: "Nachrichten an EINS" };
export const dynamic = "force-dynamic";

/**
 * One conversation (Plain's thread, Zendesk's request page): the subject as
 * the title with the trail back, its state at the row's end, then one card
 * as tall as the screen. The messages run oldest to newest and scroll in
 * it; the answer field stays at its foot under the last one. New answers
 * arrive by themselves (`Refresh`, every 20 s while the tab is visible).
 */
export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermissionOrRedirect("feedback.submit");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await supportConversation(id, session.clinicId);
  if (!data) notFound();
  const status = caseStatus(data.case.status);

  return (
    <div className={cn(PAGE_WIDTH, "flex flex-col gap-4 md:gap-6", THREAD_PAGE_HEIGHT)}>
      <Refresh />
      <SupportHead
        title={<span className="break-words">{data.case.subject}</span>}
        actions={<Status tone={status.tone}>{status.label}</Status>}
      />
      <Thread
        caseId={id}
        subject={data.case.subject}
        nonce={randomUUID()}
        readOnly={isImpersonating(session)}
        messages={data.messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          body: m.body,
          receivedAt: new Date(m.received_at).toISOString(),
        }))}
      />
    </div>
  );
}
