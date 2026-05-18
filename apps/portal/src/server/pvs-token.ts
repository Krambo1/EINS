import "server-only";

/**
 * PVS Bridge — Direction A linking token.
 *
 * Token format: `EINS-Lead-{prefix}` where `prefix` is the first 8 hex
 * characters of the request UUID. Derived deterministically from
 * `requests.id` — no separate storage required.
 *
 * The token is:
 *   1. Computed on lead intake (see leadIntakeToken).
 *   2. Surfaced to the clinic in the request detail page so MFA can paste
 *      it into the PVS bemerkung field manually.
 *   3. Written by adapter-specific Direction-A writers via the
 *      pvs-lead-token-write queue (apps/bridge owns the write side; for
 *      now we only enqueue the job, the actual PVS write happens in V1.5+).
 *   4. Parsed back on the bridge side from `event.bemerkung` during Stage 2
 *      linking (see parseLeadTokenFromBemerkung).
 *
 * Collision probability: 8 hex chars = 32 bits. For a Praxis with 10k
 * lifetime requests, probability of any prefix collision ≈ 1.2e-5. The
 * linker rejects ambiguous matches, so collisions degrade to "no match"
 * not "wrong match" — safe.
 */

const TOKEN_PREFIX = "EINS-Lead-";
const TOKEN_HEX_LENGTH = 8;

/**
 * Derive the linking token from a request UUID. Stable: feeding the same
 * UUID back always returns the same token.
 */
export function leadTokenForRequestId(requestId: string): string {
  // Strip dashes so the first 8 hex chars are predictable regardless of
  // whether the caller passes 'aaaaaaaa-bbbb-...' or 'aaaaaaaabbbb...'.
  const hex = requestId.replace(/-/g, "");
  return `${TOKEN_PREFIX}${hex.slice(0, TOKEN_HEX_LENGTH)}`;
}

/**
 * Extract a lead token from a free-text bemerkung field. Returns the token
 * AND the bare hex prefix (so the linker can SQL LIKE against requests.id).
 *
 * The regex is intentionally tolerant: leading whitespace, surrounding
 * brackets, German PVS quirks ("EINS-Lead:" with a colon, copy-paste
 * with surrounding period). We only insist on the exact token string
 * shape — 8 hex chars after the prefix.
 */
export function parseLeadTokenFromBemerkung(
  bemerkung: string
): { token: string; prefix: string } | null {
  // Case-insensitive on the "EINS-Lead" sigil since MFAs occasionally
  // type it lowercased. Between segments we accept zero-or-more spaces,
  // dashes, underscores or colons — covers "EINS-Lead-X", "EINS Lead: X",
  // "EINS_Lead_X", "EINSLeadX". The 8 hex chars themselves must match —
  // they ARE a UUID prefix.
  const match = bemerkung.match(/EINS[\s\-_:]*Lead[\s\-_:]*([0-9a-fA-F]{8})/i);
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  return { token: `${TOKEN_PREFIX}${prefix}`, prefix };
}

/**
 * Used by the request-detail UI to render the "EINS-Lead-... bei
 * Terminvereinbarung in die Bemerkung kopieren" hint to MFA.
 */
export function bemerkungInstructionFor(token: string): string {
  return (
    `Bitte beim Anlegen des Patienten in der PVS folgenden Code in das Bemerkungs-Feld einfügen: ${token}\n` +
    `Dadurch verknüpft EINS den Termin automatisch mit dieser Anfrage und berechnet ROAS aus echten Behandlungserlösen.`
  );
}
