/**
 * Pure rules for emailed one-time links (clinic magic links). No server
 * imports, so they are unit-testable.
 */

export type LinkIntent = "login" | "invite" | "set_password" | "reset_password";

/**
 * Tokens are 32 random bytes as base64url (43 chars). Anything that does not
 * look like one is rejected before it reaches the database.
 */
export function isPlausibleLinkToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length >= 32 &&
    token.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}

/** Invitations live 7 days, every other link the short login TTL (B-3). */
export function magicLinkTtlSeconds(
  intent: LinkIntent,
  ttl: { login: number; invite: number }
): number {
  return intent === "invite" ? ttl.invite : ttl.login;
}

/**
 * Which suppression reasons stop an auth mail (B-10).
 *
 * Self-requested mails (login / reset / set password) are sent even to an
 * address that once filed a spam complaint: the person just asked for this
 * link on our login page, and without it they cannot get in. A hard bounce
 * (inbox dead) and a manual block by EINS still stop it.
 * Invitations are initiated by someone else, so every transactional
 * suppression reason stops them and the inviter is told.
 */
export function suppressionBlocksAuthMail(
  intent: LinkIntent,
  reason: string | null
): boolean {
  if (!reason) return false;
  if (intent === "invite") return true;
  return reason === "bounced" || reason === "manual";
}

export type PeekReason = "invalid" | "expired" | "consumed" | "no_user";

/** Classify a magic_links row for the read-only landing page. */
export function classifyLinkRow(
  row:
    | {
        consumedAt: Date | null;
        expiresAt: Date;
        userActive: boolean;
      }
    | null
    | undefined,
  now: Date
): PeekReason | null {
  if (!row) return "invalid";
  if (row.consumedAt) return "consumed";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (!row.userActive) return "no_user";
  return null;
}
