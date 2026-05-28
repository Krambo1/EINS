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
  | { ok: true; url: string }
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
    return { ok: true, url: parsed.toString() };
  }
  if (parsed.protocol === "http:") {
    const loopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]";
    if (allowInsecureDev && loopback) {
      return { ok: true, url: parsed.toString() };
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
