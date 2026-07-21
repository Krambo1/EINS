import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";

/**
 * H12: proxy + enterprise-TLS support for the agent's outbound HTTPS.
 *
 * Two silent-forever-failure modes on a Praxis workstation:
 *
 *   1. Corporate proxy rolled out AFTER install. Node's built-in fetch
 *      (undici) does NOT honour HTTP_PROXY / HTTPS_PROXY on its own, so
 *      every POST fails with a bare `network: fetch failed` and nothing
 *      uploads, indefinitely. `configureGlobalDispatcher` wires undici's
 *      EnvHttpProxyAgent as the process-wide dispatcher when any proxy
 *      env var is set, which routes every fetch (events, heartbeat,
 *      enrollment) through the proxy.
 *
 *   2. TLS inspection. A corporate middlebox re-signs TLS with a private
 *      root CA that Node does not trust (Node ignores the Windows cert
 *      store). Every request fails certificate verification. The fix is
 *      the standard NODE_EXTRA_CA_CERTS env var pointing at the corporate
 *      root; `tlsHint` recognises the verification-failure error codes and
 *      tells the operator exactly that.
 */

/**
 * The fetch every outbound agent request must go through.
 *
 * Why an indirection: Node's BUILT-IN fetch reads a different global-dispatcher
 * slot (Symbol "undici.globalDispatcher.2" from Node's bundled undici) than the
 * npm `undici` package that ships EnvHttpProxyAgent (slot ".1"), so
 * setGlobalDispatcher() alone never routes the built-in fetch through the
 * proxy: the wiring would be a silent no-op. When a proxy is configured we
 * therefore ALSO switch this binding to undici's own fetch, which honours the
 * installed dispatcher. In the direct-connection common case it delegates to
 * globalThis.fetch at call time (so tests that stub globalThis.fetch keep
 * working and behavior is byte-identical to before).
 */
export let agentFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, init);

/** Test-only: restore the direct globalThis.fetch delegation. */
export function _resetAgentFetchForTests(): void {
  agentFetch = (input, init) => globalThis.fetch(input, init);
}

/** Proxy env vars, checked in precedence order (HTTPS first for our https
 *  portal, then HTTP, both case variants that Windows / POSIX shells use). */
function activeProxyEnv(): { name: string; value: string } | null {
  const candidates = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
  ];
  for (const name of candidates) {
    const value = process.env[name];
    if (value && value.trim()) return { name, value: value.trim() };
  }
  return null;
}

/**
 * Install the EnvHttpProxyAgent as the global undici dispatcher when a
 * proxy is configured via the environment. No-op (returns false) when no
 * proxy env var is present, so the direct-connection common case is
 * unchanged. Idempotent enough for our single startup call; calling twice
 * would just re-install an equivalent dispatcher.
 *
 * EnvHttpProxyAgent reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY itself, so we
 * only decide WHETHER to install it and log WHAT we saw.
 */
export function configureGlobalDispatcher(
  log: (msg: string) => void = (m) => console.log(m)
): boolean {
  const proxy = activeProxyEnv();
  if (!proxy) return false;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  // The dispatcher above lives in the npm undici registry, which the built-in
  // fetch never consults: switch agentFetch to undici's fetch so it applies.
  agentFetch = undiciFetch as unknown as typeof globalThis.fetch;
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
  log(
    `[agent] outbound HTTPS routed through proxy from ${proxy.name}=${proxy.value}` +
      (noProxy ? ` (NO_PROXY=${noProxy})` : "") +
      `. If the proxy performs TLS inspection, set NODE_EXTRA_CA_CERTS to the ` +
      `corporate root CA .pem or the agent cannot verify the portal certificate.`
  );
  return true;
}

/**
 * TLS-verification error codes that mean "the portal certificate could not
 * be verified against Node's trust store", which on a Praxis machine almost
 * always means a TLS-inspecting middlebox re-signed the connection with a
 * private root CA that Node does not know about.
 */
const TLS_VERIFY_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_UNTRUSTED",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * Walk an error's `.cause` chain (undici wraps the underlying TLS error as
 * the cause of "fetch failed") looking for a certificate-verification code.
 * Returns a short operator hint when found, else null. Pure + testable.
 */
export function tlsHint(err: unknown): string | null {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && cur && !seen.has(cur); depth++) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && TLS_VERIFY_CODES.has(code)) {
      return (
        `TLS certificate verification failed (${code}). This is typical behind a ` +
        `TLS-inspecting corporate proxy or firewall. Point NODE_EXTRA_CA_CERTS at ` +
        `the corporate root CA (.pem) and restart the agent.`
      );
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
