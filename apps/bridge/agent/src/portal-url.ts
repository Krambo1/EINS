/**
 * P0-4: validate that a portal URL is safe to POST patient data to.
 *
 * Rule: https:// is the only acceptable scheme. The single exception is
 * `--allow-insecure-dev` + a loopback host, which the developer running
 * the agent against a local portal needs. There is no production-equivalent
 * escape hatch — for staging, the staging URL is https:// like prod.
 *
 * Lives in its own module so the validator can be unit-tested without
 * pulling in index.ts (which runs `main()` as a side effect on import).
 */

export type PortalUrlCheck =
  | { ok: true; url: string; warning?: string }
  | { ok: false; reason: string };

export function validatePortalUrl(
  rawUrl: string,
  allowInsecureDev: boolean
): PortalUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      reason: `portal URL is not parseable: '${rawUrl}'`,
    };
  }
  if (parsed.protocol === "https:") {
    return normalized(parsed);
  }
  if (parsed.protocol === "http:") {
    const loopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]";
    if (allowInsecureDev && loopback) {
      return normalized(parsed);
    }
    return {
      ok: false,
      reason: allowInsecureDev
        ? `http:// portal URL '${rawUrl}' must point at localhost when --allow-insecure-dev is set`
        : `http:// portal URL '${rawUrl}' rejected; use https:// (or --allow-insecure-dev for localhost only)`,
    };
  }
  return {
    ok: false,
    reason: `unsupported portal URL scheme '${parsed.protocol}' (expected https://)`,
  };
}

/**
 * L23: return the base URL the agent should actually persist and join paths
 * against, NOT the raw string. A portal base URL legitimately carries only a
 * scheme, host (with optional port), and an optional path prefix; a query or
 * fragment is always an operator paste mistake (e.g. copying a browser URL
 * with `?tab=...`). Left in place they survive `new URL(path, base)` joins and
 * produce a broken endpoint. We strip them (surfacing a warning the caller
 * logs) and drop a trailing slash so joins are predictable.
 */
function normalized(parsed: URL): PortalUrlCheck {
  let warning: string | undefined;
  if (parsed.search || parsed.hash) {
    warning =
      `portal URL carried a query string or fragment which was ignored ` +
      `(${parsed.search}${parsed.hash}). If your portal lives under a path ` +
      `prefix, keep only the path, not query parameters.`;
    parsed.search = "";
    parsed.hash = "";
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const url = `${parsed.protocol}//${parsed.host}${path}`;
  return warning ? { ok: true, url, warning } : { ok: true, url };
}

/**
 * L23: join a root-absolute portal endpoint path (e.g. "/api/pvs/events") onto
 * a validated base URL with the WHATWG URL parser instead of string
 * concatenation. This is `//`-safe regardless of whether the base has a
 * trailing slash and cannot be fooled by a stray query/fragment on the base
 * (an absolute path resolves against the base's origin). All portal endpoints
 * the agent calls are root-absolute, which is why this resolves against the
 * origin by design.
 */
export function portalEndpoint(base: string, path: string): string {
  return new URL(path, base).toString();
}
