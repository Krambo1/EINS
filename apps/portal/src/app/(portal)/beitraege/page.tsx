import Link from "next/link";
import { Badge, Button, Card, EmptyState, Label, Textarea } from "@eins/ui";
import { CircleCheck, Clapperboard } from "lucide-react";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listContentItemsForPractice, type ContentItemView } from "@/server/content";
import { listApprovalsForPractice, type PracticeApprovalView } from "@/server/content-approval";
import { getStorage } from "@/server/storage";
import { canDecideApproval } from "@/lib/content-gate";
import { formatApprovalDue } from "@/lib/content-approval";
import type { Role } from "@/lib/constants";
import { decideBeitragAction } from "./actions";
import { DecisionSubmitButton } from "./DecisionSubmitButton";
import { formatDate, formatNumber } from "@/lib/formatting";
import { CONTENT_FORMAT_LABELS, type ContentFormat, type ContentStatus } from "@/lib/content-status";

export const metadata = { title: "Beiträge" };

const PLATFORM_LABELS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

/** Plain-language state of a post EINS is still working on. */
const IN_WORK: Partial<Record<ContentStatus, { label: string; tone: "warn" | "accent" }>> = {
  aenderung: { label: "Wird überarbeitet", tone: "warn" },
  freigegeben: { label: "Freigegeben", tone: "accent" },
  geplant: { label: "Geplant", tone: "accent" },
};

function formatLabel(f: string): string {
  return CONTENT_FORMAT_LABELS[f as ContentFormat] ?? f;
}

/**
 * The Praxis's posts in three blocks, in the order the Praxis needs them:
 * what waits for its decision (with the post itself to look at), what EINS
 * is still working on, and what is published with the Anfragen it brought.
 * Drafts stay with EINS and are not listed.
 */
export default async function BeitraegePage() {
  const session = await requirePermissionOrRedirect("assets.view");
  const [items, approvals] = await Promise.all([
    listContentItemsForPractice(session.clinicId, session.userId),
    listApprovalsForPractice(session.clinicId, session.userId),
  ]);

  // Posts this person can decide first; the ones only the Inhaber:in may approve after them.
  const decidable = (i: ContentItemView) => {
    const a = approvals.get(i.id);
    return !!a && !a.decision && canDecideApproval(session.role, a.inhaberOnly);
  };
  const waiting = items
    .filter((i) => i.status === "zur_freigabe")
    .sort((a, b) => Number(decidable(b)) - Number(decidable(a)));
  const inWork = items.filter((i) => i.status in IN_WORK);
  const published = items.filter((i) => i.status === "live" || i.status === "gestoppt");

  const storage = getStorage();
  const previews = new Map(
    await Promise.all(
      waiting
        .filter((i) => i.assetStorageKey)
        .map(async (i) => [i.id, await storage.urlFor(i.assetStorageKey!, { expiresInSeconds: 3600 })] as const)
    )
  );

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Beiträge.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Was EINS für Ihre Praxis veröffentlicht. Ohne Ihre Freigabe geht kein Beitrag online.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="h-8 w-8" />}
          title="Noch keine Beiträge"
          description="Hier erscheint jeder Beitrag, sobald EINS ihn Ihnen zur Freigabe schickt. Sie bekommen dazu eine E-Mail."
        />
      ) : (
        <>
          {waiting.length > 0 ? (
            <section className="space-y-4" aria-labelledby="freigabe">
              <SectionHead id="freigabe" title="Wartet auf Ihre Freigabe" count={waiting.length} />
              <div className="space-y-6">
                {waiting.map((item) => (
                  <ApprovalCard
                    key={item.id}
                    item={item}
                    approval={approvals.get(item.id) ?? null}
                    previewUrl={previews.get(item.id) ?? null}
                    role={session.role}
                  />
                ))}
              </div>
            </section>
          ) : (
            <p className="flex items-center gap-3 rounded-lg border border-border bg-bg-primary px-5 py-4 text-base">
              <CircleCheck className="h-5 w-5 shrink-0 text-tone-good" aria-hidden />
              Nichts wartet auf Ihre Freigabe. Neue Beiträge kündigen wir Ihnen per E-Mail an.
            </p>
          )}

          {inWork.length > 0 && (
            <section className="space-y-4" aria-labelledby="in-arbeit">
              <SectionHead id="in-arbeit" title="In Arbeit bei EINS" note="Hier müssen Sie nichts tun." />
              <Card className="!py-2 md:!py-2">
                <ul className="divide-y divide-border">
                  {inWork.map((item) => (
                    <InWorkRow key={item.id} item={item} approval={approvals.get(item.id) ?? null} />
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {published.length > 0 && (
            <section className="space-y-4" aria-labelledby="veroeffentlicht">
              <SectionHead
                id="veroeffentlicht"
                title="Veröffentlicht"
                note="Mit den Anfragen, die jeder Beitrag gebracht hat."
              />
              <Card className="!py-2 md:!py-2">
                <ul className="divide-y divide-border">
                  {published.map((item) => (
                    <PublishedRow key={item.id} item={item} />
                  ))}
                </ul>
              </Card>
            </section>
          )}

          <p className="text-base text-fg-primary">
            Alle Videos und Bilder für Ihre Praxis finden Sie unter{" "}
            <Link href="/medien" className="font-medium underline underline-offset-4">
              Medien
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

function SectionHead({ id, title, count, note }: { id: string; title: string; count?: number; note?: string }) {
  return (
    <div>
      <h2 id={id} className="text-xl font-semibold md:text-2xl">
        {title}
        {count !== undefined && <span className="ml-2 font-normal text-fg-secondary tabular-nums">{count}</span>}
      </h2>
      {note && <p className="mt-1 text-base text-fg-secondary">{note}</p>}
    </div>
  );
}

/** One post waiting for the Praxis: the post itself on the left, the decision on the right. */
function ApprovalCard({
  item,
  approval,
  previewUrl,
  role,
}: {
  item: ContentItemView;
  approval: PracticeApprovalView | null;
  previewUrl: string | null;
  role: Role;
}) {
  const meta = [formatLabel(item.format), item.treatmentName, item.usesClone ? "mit Ihrem KI-Klon" : null].filter(
    Boolean
  );
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-bg-primary shadow-[var(--shadow-card)]">
      <div className={previewUrl ? "md:grid md:grid-cols-[minmax(0,280px)_1fr]" : undefined}>
        {previewUrl && (
          <div className="flex items-center justify-center bg-black md:border-r md:border-border">
            {item.assetIsVideo ? (
              <video
                src={previewUrl}
                controls
                playsInline
                preload="metadata"
                className="max-h-[420px] w-full object-contain md:h-full md:max-h-[560px]"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={item.title}
                className="max-h-[420px] w-full object-contain md:h-full md:max-h-[560px]"
              />
            )}
          </div>
        )}

        <div className="space-y-6 p-6 md:p-8">
          {/* Title first, grey meta line under it, like every list below. */}
          <div className="space-y-1">
            <h3 className="text-xl font-semibold leading-snug md:text-2xl">{item.title}</h3>
            <p className="text-sm text-fg-secondary">{meta.join(" · ")}</p>
          </div>

          {item.caption ? (
            <div>
              <p className="text-sm font-medium text-fg-primary">Text zum Beitrag</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed">{item.caption}</p>
            </div>
          ) : (
            <p className="text-base text-fg-secondary">Dieser Beitrag hat keinen Text.</p>
          )}

          <div className="border-t border-border pt-6">
            <Decision item={item} approval={approval} role={role} />
          </div>
        </div>
      </div>
    </article>
  );
}

function Decision({
  item,
  approval,
  role,
}: {
  item: ContentItemView;
  approval: PracticeApprovalView | null;
  role: Role;
}) {
  if (!approval) {
    return <p className="text-base text-fg-primary">Die Freigabe dazu bekommen Sie per E-Mail.</p>;
  }
  if (approval.decision) {
    return <p className="text-base text-fg-primary">Ihre Entscheidung ist gespeichert. EINS übernimmt ab hier.</p>;
  }
  const due = formatApprovalDue(approval.dueAt);
  if (!canDecideApproval(role, approval.inhaberOnly)) {
    return (
      <p className="text-base text-fg-primary">
        {approval.inhaberOnly
          ? "Diesen Beitrag gibt die Inhaberin oder der Inhaber frei, weil darin der KI-Klon erscheint."
          : "Diesen Beitrag gibt die Inhaberin, der Inhaber oder das Marketing frei."}{" "}
        Frist: {due}.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-base font-medium text-fg-primary">
        Bitte bis {due} freigeben oder sagen, was wir ändern sollen.
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <form action={decideBeitragAction}>
          <input type="hidden" name="approvalId" value={approval.id} />
          <input type="hidden" name="decision" value="freigegeben" />
          <DecisionSubmitButton>Freigeben</DecisionSubmitButton>
        </form>
        <details className="group w-full sm:w-auto sm:flex-1">
          <summary className="inline-flex cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <Button asChild variant="outline">
              <span>Änderung wünschen</span>
            </Button>
          </summary>
          <form action={decideBeitragAction} className="mt-4 space-y-3">
            <input type="hidden" name="approvalId" value={approval.id} />
            <input type="hidden" name="decision" value="aenderung" />
            <Label htmlFor={`aenderung-${approval.id}`}>Was sollen wir an „{item.title}“ ändern?</Label>
            <Textarea id={`aenderung-${approval.id}`} name="changeText" rows={4} required maxLength={2000} />
            <DecisionSubmitButton variant="outline">Änderung senden</DecisionSubmitButton>
          </form>
        </details>
      </div>
    </div>
  );
}

function InWorkRow({ item, approval }: { item: ContentItemView; approval: PracticeApprovalView | null }) {
  const state = IN_WORK[item.status]!;
  const changeText = item.status === "aenderung" ? approval?.decision?.changeText : null;
  return (
    <li className="py-4">
      <p className="text-base font-medium">{item.title}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
        <Badge tone={state.tone}>{state.label}</Badge>
        <span>· {formatLabel(item.format)}</span>
      </p>
      {changeText && (
        <p className="mt-2 whitespace-pre-wrap break-words text-base text-fg-primary">
          Ihr Wunsch: „{changeText}“
        </p>
      )}
    </li>
  );
}

function PublishedRow({ item }: { item: ContentItemView }) {
  const q = item.inquiries;
  const live = item.status === "live";
  const channels = [
    q.formular > 0 ? `${formatNumber(q.formular)} Formular` : null,
    q.anruf > 0 ? `${formatNumber(q.anruf)} Anruf` : null,
    q.buchung > 0 ? `${formatNumber(q.buchung)} Buchung` : null,
    q.ohne > 0 ? `${formatNumber(q.ohne)} sonstige` : null,
  ].filter(Boolean);
  return (
    <li className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 space-y-1">
        <p className={`text-base font-medium ${live ? "" : "text-fg-secondary"}`}>{item.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
          {live ? <Badge tone="good">Live</Badge> : <Badge tone="bad">Gestoppt</Badge>}
          <span>
            ·{" "}
            {[
              formatLabel(item.format),
              live && item.liveSince ? `seit ${formatDate(item.liveSince)}` : null,
              !live && item.stoppedAt ? `am ${formatDate(item.stoppedAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {item.publications.map((p) => (
            <a
              key={p.id}
              href={p.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-fg-primary underline underline-offset-4"
            >
              Auf {PLATFORM_LABELS[p.platform] ?? p.platform} ansehen
            </a>
          ))}
        </p>
        {!live && item.stopReason && <p className="text-sm text-fg-secondary">Grund: {item.stopReason}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-2xl font-semibold leading-none tabular-nums">{formatNumber(q.total)}</p>
        <p className="mt-1 text-sm text-fg-secondary">{q.total === 1 ? "Anfrage" : "Anfragen"}</p>
        {channels.length > 0 && <p className="mt-0.5 text-sm text-fg-secondary">{channels.join(" · ")}</p>}
      </div>
    </li>
  );
}
