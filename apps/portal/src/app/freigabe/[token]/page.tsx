import type { Metadata } from "next";
import { Card, CardContent, Label, Textarea } from "@eins/ui";
import { loadApprovalForLink } from "@/server/content-approval";
import { getStorage } from "@/server/storage";
import { rateLimit } from "@/server/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import { APPROVAL_DECISION_LABELS, CHANGE_TEXT_MAX, LINK_EXPIRED_MESSAGE, formatApprovalDue } from "@/lib/content-approval";
import { KI_LABEL, hasKiLabel } from "@/lib/content-gate";
import { formatDateTime } from "@/lib/formatting";
import { DecisionSubmitButton } from "@/app/(portal)/beitraege/DecisionSubmitButton";

/**
 * Public one-click approval page (D7, D8): /freigabe/<token> from the batch
 * e-mail. No login: the 64-hex token is the credential (only its sha256 is
 * stored). GET only shows the post, so mail scanners that open links decide
 * nothing; the decision is a POST to /api/freigabe/<token>. Outside the
 * (portal) group, so no session is required and no other route is opened.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Freigabe",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const ERRORS: Record<string, string> = {
  text: "Bitte beschreiben Sie, was wir ändern sollen.",
  abgelaufen: LINK_EXPIRED_MESSAGE,
  zu_viele: "Zu viele Versuche. Bitte warten Sie eine Minute und versuchen Sie es erneut.",
  ungueltig: "Die Eingabe war ungültig. Bitte versuchen Sie es erneut.",
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg-primary">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="px-6 pb-8 text-center text-sm text-fg-secondary">EINS · Freigabe Ihrer Beiträge</footer>
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <Card>
        <CardContent className="space-y-2 py-6">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-base text-fg-primary">{text}</p>
        </CardContent>
      </Card>
    </Shell>
  );
}

export default async function FreigabePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = await searchParams;

  const ip = (await getTrustedClientIp()) ?? "unknown";
  const rl = await rateLimit("content-approval-view", ip, { limit: 60, windowSeconds: 60 });
  if (!rl.ok) return <Notice title="Bitte kurz warten" text={ERRORS.zu_viele!} />;

  const view = await loadApprovalForLink(token);
  if (!view) {
    return (
      <Notice
        title="Link nicht gefunden"
        text="Diesen Freigabe-Link gibt es nicht oder nicht mehr. Bitte entscheiden Sie im Portal unter Beiträge."
      />
    );
  }

  const error = typeof sp.fehler === "string" ? ERRORS[sp.fehler] ?? null : null;
  const assetUrl = view.asset ? await getStorage().urlFor(view.asset.storageKey, { expiresInSeconds: 3600 }) : null;
  const isVideo = view.asset ? view.asset.kind === "video" || (view.asset.mimeType ?? "").startsWith("video/") : false;
  const open = !view.decision;
  const withdrawn = open && view.itemStatus !== "zur_freigabe";

  return (
    <Shell>
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-base text-fg-secondary">{view.practiceName}</p>
          <h1 className="text-3xl font-semibold">{view.title}</h1>
          <p className="text-base text-fg-secondary">{view.format}</p>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] px-4 py-3 text-base text-tone-bad"
          >
            {error}
          </p>
        )}

        {view.decision && (
          <div
            role="status"
            className="space-y-1 rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-4 py-3 text-base"
          >
            <p className="font-medium">
              {APPROVAL_DECISION_LABELS[view.decision.decision]} am {formatDateTime(view.decision.decidedAt)}
              {view.decision.decidedVia === "portal" ? " im Portal" : ""}.
            </p>
            {view.decision.changeText && (
              <p className="whitespace-pre-wrap break-words">Ihr Änderungswunsch: {view.decision.changeText}</p>
            )}
            <p className="text-fg-secondary">
              {view.decision.decision === "freigegeben"
                ? "Danke. Der Beitrag kann jetzt veröffentlicht werden."
                : "Danke. EINS überarbeitet den Beitrag und schickt ihn erneut zur Freigabe."}
            </p>
          </div>
        )}

        <Card>
          <CardContent className="space-y-4 py-6">
            {assetUrl &&
              (isVideo ? (
                <video src={assetUrl} controls playsInline preload="metadata" className="w-full rounded-md bg-black" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl} alt={view.title} className="w-full rounded-md" />
              ))}
            {view.caption ? (
              <div>
                <p className="text-sm text-fg-secondary">Beitragstext</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-base">{view.caption}</p>
              </div>
            ) : (
              <p className="text-base text-fg-secondary">Dieser Beitrag hat keinen Text.</p>
            )}
            {(view.aiContent || view.usesClone || hasKiLabel(view.caption)) && (
              <p className="text-sm text-fg-primary">
                Der Beitrag ist mit KI erstellt und trägt den Hinweis „{KI_LABEL}“.
                {view.usesClone ? " In diesem Beitrag erscheint Ihr KI-Klon." : ""}
              </p>
            )}
          </CardContent>
        </Card>

        {withdrawn ? (
          <p className="text-base text-fg-primary">
            EINS hat diesen Beitrag zurückgeholt. Sie müssen nichts tun.
          </p>
        ) : open && view.expired ? (
          <p className="text-base text-fg-primary">{LINK_EXPIRED_MESSAGE}</p>
        ) : open ? (
          <section className="space-y-4">
            <p className="text-base text-fg-primary">
              Ohne Ihre Freigabe geht kein Beitrag online. Bitte geben Sie den Beitrag bis {formatApprovalDue(view.dueAt)}{" "}
              frei oder beschreiben Sie, was wir ändern sollen.
            </p>
            <form method="post" action={`/api/freigabe/${token}`}>
              <input type="hidden" name="decision" value="freigegeben" />
              <DecisionSubmitButton size="md">Freigeben</DecisionSubmitButton>
            </form>
            <form method="post" action={`/api/freigabe/${token}`} className="space-y-2">
              <input type="hidden" name="decision" value="aenderung" />
              <Label htmlFor="changeText">Änderung wünschen</Label>
              <Textarea
                id="changeText"
                name="changeText"
                rows={4}
                required
                maxLength={CHANGE_TEXT_MAX}
                placeholder="Was sollen wir ändern?"
              />
              <DecisionSubmitButton size="md" variant="outline">
                Änderung wünschen
              </DecisionSubmitButton>
            </form>
            <p className="text-sm text-fg-secondary">
              Es gilt die erste Entscheidung, hier oder im Portal unter Beiträge.
            </p>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
