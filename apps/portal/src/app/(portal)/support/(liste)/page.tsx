import Link from "next/link";
import { randomUUID } from "node:crypto";
import { cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { isImpersonating } from "@/auth/impersonation-guard";
import { formatRelative } from "@/lib/formatting";
import { supportCases, supportClient } from "@/server/support";
import { WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { Status } from "../../einstellungen/_components/settings-ui";
import { NewMessageForm } from "../_components/NewMessageForm";
import { SupportViews } from "../_components/SupportViews";
import { IMPERSONATION_NOTE, caseStatus } from "../_lib/labels";
import { LIST_BODY_HEIGHT, LIST_CARD, PAGE_WIDTH, ROW_HEIGHT } from "../_lib/sizes";

export const metadata = { title: "Nachrichten an EINS" };
export const dynamic = "force-dynamic";

/**
 * The Praxis' conversations with EINS, newest first, as one card of fixed
 * height whose rows scroll (Intercom's Messenger list, Zendesk's "My
 * requests"): the subject and when it last changed, then its state. A new
 * message opens in place of the list (`SupportViews`).
 */
export default async function SupportPage() {
  const session = await requirePermissionOrRedirect("feedback.submit");
  const [client, cases] = await Promise.all([supportClient(session.clinicId), supportCases(session.clinicId)]);

  const list = client ? (
    <section aria-label="Unterhaltungen" className={LIST_CARD}>
      {cases.length === 0 ? (
        <div className={cn("flex", LIST_BODY_HEIGHT)}>
          <p className="m-auto text-[15px] leading-6 text-fg-secondary">Noch keine Nachrichten.</p>
        </div>
      ) : (
        <ul className={cn("scroll-shadows -mx-3 divide-y divide-border px-3 [--scroll-bg:var(--surface-tile)]", LIST_BODY_HEIGHT)}>
          {cases.map((c) => {
            const status = caseStatus(c.status);
            return (
              // 4 px white inside the hairlines, the wash 12 px past the text (DESIGN.md section 5).
              <li key={c.id} className={WASH_ROW}>
                <Link
                  href={`/support/${c.id}`}
                  className={cn(
                    "block rounded-[var(--r-panel)] py-3 transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    WASH_AREA,
                    ROW_HEIGHT
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    {/* A long subject wraps, never cut. */}
                    <span className="min-w-0 break-words text-[15px] font-medium leading-5 text-fg-primary">
                      {c.subject}
                    </span>
                    <span suppressHydrationWarning className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary">
                      {formatRelative(c.updated_at)}
                    </span>
                  </span>
                  <span className="mt-1 flex h-5 items-center">
                    <Status tone={status.tone}>{status.label}</Status>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  ) : (
    <section className={cn(LIST_CARD, "px-5 py-5 md:px-6 md:py-6")}>
      <p className="text-[15px] leading-6 text-fg-primary">
        Nachrichten im Portal sind für Ihre Praxis noch nicht eingerichtet. Sie erreichen uns unter{" "}
        <a
          href="mailto:team@eins.ag"
          className="rounded-[var(--r-small)] underline decoration-fg-tertiary underline-offset-4 hover:decoration-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          team@eins.ag
        </a>
        .
      </p>
    </section>
  );

  const form = isImpersonating(session) ? (
    <section className={cn(LIST_CARD, "px-5 py-5 md:px-6 md:py-6")}>
      <p className="text-[15px] leading-6 text-fg-secondary">{IMPERSONATION_NOTE}</p>
    </section>
  ) : (
    <NewMessageForm nonce={randomUUID()} />
  );

  return (
    <div className={PAGE_WIDTH}>
      <SupportViews canWrite={client != null} list={list} form={form} />
    </div>
  );
}
