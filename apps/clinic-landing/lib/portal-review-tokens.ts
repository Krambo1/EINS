/**
 * Thin server-side helpers for talking to the portal's /api/review-tokens
 * endpoints. The token in the URL is the credential — no further auth.
 *
 * Used by app/r/[token]/* routes. Failures are reported to the caller (we
 * don't swallow them here — the patient-facing pages decide what to render
 * on network failure).
 */

const TOKEN_REGEX = /^[a-f0-9]{64}$/i;

export function isValidTokenShape(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

export interface ResolvedReview {
  clinic: {
    displayName: string;
    googleReviewUrl: string | null;
    jamedaReviewUrl: string | null;
    suggestedPlatform: "google" | "jameda" | null;
  };
  recall: {
    recordedRating: number | null;
    ratingClickedAt: string | null;
    publicClickedAt: string | null;
    feedbackAt: string | null;
  };
  patient: {
    firstName: string | null;
  };
}

function portalBase(): string {
  const url = process.env.PORTAL_URL;
  if (!url) throw new Error("PORTAL_URL not configured");
  return url.replace(/\/$/, "");
}

export async function resolveToken(token: string): Promise<ResolvedReview | null> {
  if (!isValidTokenShape(token)) return null;
  const res = await fetch(`${portalBase()}/api/review-tokens/${token}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as ResolvedReview;
}

export async function postClick(
  token: string,
  body: {
    rating?: number;
    target: "land" | "public" | "private";
    platform?: "google" | "jameda";
  }
): Promise<void> {
  if (!isValidTokenShape(token)) return;
  await fetch(`${portalBase()}/api/review-tokens/${token}/click`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch((err) => {
    console.warn("[review-tokens] click ping failed:", err);
  });
}

export async function postFeedback(
  token: string,
  body: {
    rating: number;
    freeText?: string;
    contactBackOk: boolean;
    contactName?: string;
    contactEmail?: string;
  }
): Promise<{ ok: boolean; feedbackId?: string }> {
  if (!isValidTokenShape(token)) return { ok: false };
  const res = await fetch(`${portalBase()}/api/review-tokens/${token}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false };
  const json = (await res.json()) as { feedbackId?: string };
  return { ok: true, feedbackId: json.feedbackId };
}

export async function postUnsubscribe(token: string): Promise<{
  ok: boolean;
  clinicName: string | null;
}> {
  if (!isValidTokenShape(token)) return { ok: false, clinicName: null };
  const res = await fetch(
    `${portalBase()}/api/review-tokens/${token}/unsubscribe`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  if (!res.ok) return { ok: false, clinicName: null };
  const json = (await res.json()) as {
    ok: boolean;
    clinicName: string | null;
  };
  return { ok: json.ok, clinicName: json.clinicName };
}
