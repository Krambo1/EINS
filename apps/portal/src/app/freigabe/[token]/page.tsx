import type { Metadata } from "next";
import { loadApprovalForLink } from "@/server/content-approval";
import { getStorage } from "@/server/storage";
import { rateLimit } from "@/server/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import {
  APPROVAL_DECISION_LABELS,
  CHANGE_TEXT_EMPTY_MESSAGE,
  CHANGE_TEXT_TOO_LONG_MESSAGE,
  LINK_EXPIRED_MESSAGE,
  formatApprovalDue,
} from "@/lib/content-approval";
import { KI_LABEL, hasKiLabel } from "@/lib/content-gate";
import { formatDateTime } from "@/lib/formatting";
import { POST_STATUS } from "@/app/(portal)/inhalte/_lib/view";
import { DECISION_BAND } from "../_lib/sizes";
import { Decision } from "../_components/Decision";
import { CaptionWell, Facts, Frame, Notice, Outcome, PostCard, PostHead, PostTile } from "../_components/parts";

/**
 * Public one-click approval page (D7, D8): /freigabe/<token> from the batch
 * e-mail. No login: the 64-hex token is the credential (only its sha256 is
 * stored). GET only shows the post, so mail scanners that open links decide
 * nothing; the decision is a POST to /api/freigabe/<token>. Outside the
 * (portal) group, so no session is required and no other route is opened.
 *
 * Mostly opened on a phone to look at one post and decide. Inhalte's "Zur
 * Freigabe" without the portal around it: the post as a raised tile, the
 * title, the text in a well of one height, the two buttons under it. The
 * result, an error and the change field all take the place of something, so
 * the post and the buttons stand still in every state (DESIGN.md section 10).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Freigabe",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const ERRORS: Record<string, string> = {
  text: CHANGE_TEXT_EMPTY_MESSAGE,
  zu_lang: CHANGE_TEXT_TOO_LONG_MESSAGE,
  abgelaufen: LINK_EXPIRED_MESSAGE,
  zu_viele: "Zu viele Versuche. Bitte warten Sie eine Minute und versuchen Sie es erneut.",
  ungueltig: "Die Eingabe war ungültig. Bitte versuchen Sie es erneut.",
};

const VIDEO_ID = "freigabe-video";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
        text="Diesen Freigabe-Link gibt es nicht oder nicht mehr. Bitte entscheiden Sie im Portal unter Inhalte."
      />
    );
  }

  const fehler = typeof sp.fehler === "string" ? sp.fehler : null;
  const error = fehler ? ERRORS[fehler] ?? null : null;
  const assetUrl = view.asset ? await getStorage().urlFor(view.asset.storageKey, { expiresInSeconds: 3600 }) : null;
  const isVideo = view.asset ? view.asset.kind === "video" || (view.asset.mimeType ?? "").startsWith("video/") : false;
  const open = !view.decision;
  const withdrawn = open && view.itemStatus !== "zur_freigabe";
  const decidable = open && !withdrawn && !view.expired;
  const ki =
    view.aiContent || view.usesClone || hasKiLabel(view.caption)
      ? `Der Beitrag ist mit KI erstellt und trägt den Hinweis „${KI_LABEL}“.${view.usesClone ? " In diesem Beitrag erscheint Ihr KI-Klon." : ""}`
      : null;
  const well = <CaptionWell caption={view.caption} />;

  return (
    <Frame>
      <PostCard>
        <PostTile
          practiceName={view.practiceName}
          title={view.title}
          file={assetUrl ? { url: assetUrl, isVideo, id: isVideo ? VIDEO_ID : undefined } : null}
        />
        <div className="min-w-0">
          <PostHead format={view.format} title={view.title} />
          <div className="mt-4">
            {decidable ? (
              <Decision
                action={`/api/freigabe/${token}`}
                well={well}
                videoId={assetUrl && isVideo ? VIDEO_ID : null}
                startChanging={fehler === "text" || fehler === "zu_lang"}
                error={error}
                emptyError={CHANGE_TEXT_EMPTY_MESSAGE}
              />
            ) : (
              <>
                {well}
                <div className={DECISION_BAND}>
                  {view.decision ? (
                    <Outcome
                      dot={POST_STATUS[view.decision.decision].dot}
                      note={
                        <>
                          <p className="text-sm leading-5 text-fg-secondary">
                            {view.decision.decision === "freigegeben"
                              ? "Danke. Der Beitrag kann jetzt veröffentlicht werden."
                              : "Danke. EINS überarbeitet den Beitrag und schickt ihn erneut zur Freigabe."}
                          </p>
                          {view.decision.changeText && (
                            <p className="elev-inset mt-3 whitespace-pre-wrap break-words rounded-[var(--r-panel)] bg-[var(--well)] px-4 py-3 text-[15px] leading-6 text-fg-primary">
                              <span className="text-fg-secondary">Ihr Änderungswunsch:</span> {view.decision.changeText}
                            </p>
                          )}
                        </>
                      }
                    >
                      {APPROVAL_DECISION_LABELS[view.decision.decision]} am {formatDateTime(view.decision.decidedAt)}
                      {view.decision.decidedVia === "portal" ? " im Portal" : ""}.
                    </Outcome>
                  ) : (
                    <Outcome>
                      {withdrawn ? "EINS hat diesen Beitrag zurückgeholt. Sie müssen nichts tun." : LINK_EXPIRED_MESSAGE}
                    </Outcome>
                  )}
                </div>
              </>
            )}
          </div>
          <Facts due={decidable ? formatApprovalDue(view.dueAt) : null} ki={ki} />
          {decidable && (
            <p className="mt-3 text-sm leading-5 text-fg-secondary">
              Es gilt die erste Entscheidung, hier oder im Portal unter Inhalte.
            </p>
          )}
        </div>
      </PostCard>
    </Frame>
  );
}
