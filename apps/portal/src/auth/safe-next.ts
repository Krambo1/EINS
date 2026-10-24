/**
 * Return-path handling for "nach dem Login zurück zur Seite" (B-6).
 *
 * `requireSession()` appends `?next=<pathname>` when it bounces a user to
 * /login; the login action redirects there after success. Only same-app,
 * relative portal paths are accepted, so `next` can never become an open
 * redirect (`//evil.example`, `/\evil`, absolute URLs, control characters) or
 * point back into the auth / API / admin surface.
 */

const BLOCKED_PREFIXES = ["/api", "/login", "/set-password", "/forgot-password", "/admin", "/_next"];

export function safeNextPath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (value.length < 2 || value.length > 512) return null;
  if (!value.startsWith("/")) return null;
  // Protocol-relative and backslash tricks: "//host", "/\host".
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  // No control characters or whitespace anywhere (header splitting, tabs that
  // browsers strip to form "//").
  if (/[\u0000-\u001f\u007f\s\\]/.test(value)) return null;
  const pathOnly = value.split(/[?#]/, 1)[0]!.toLowerCase();
  for (const prefix of BLOCKED_PREFIXES) {
    if (pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)) return null;
  }
  return value;
}

/** Build the /login URL used when a protected page needs a session. */
export function loginRedirectPath(opts: {
  next?: string | null;
  expired?: boolean;
}): string {
  const params = new URLSearchParams();
  if (opts.expired) params.set("error", "session_expired");
  const next = safeNextPath(opts.next);
  if (next && next !== "/") params.set("next", next);
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}
