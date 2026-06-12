/**
 * Per-isolate, in-memory fixed-window rate limiter for the unauthenticated
 * telemetry sinks (`/api/rum`, `/api/track`).
 *
 * These endpoints accept anonymous POSTs, so without a cap they are a free
 * cost-amplification + log-forging target (pentest authn-08-telemetry). They
 * run on the node runtime with no shared store, so a per-isolate map is the
 * pragmatic bound — it does not need to be globally exact, only enough to
 * blunt a single source hammering one instance.
 */

const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();

/** Returns true if this IP is still under `limitPerMinute` for the window. */
export function allowRequest(ip: string, limitPerMinute: number): boolean {
  const now = Date.now();
  // Unbounded-growth backstop: a flood of unique spoofed IPs must not grow
  // the map without bound.
  if (buckets.size > 10_000) buckets.clear();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  bucket.count++;
  return bucket.count <= limitPerMinute;
}

/**
 * First trustworthy client IP. Prefers `x-real-ip` (set by the platform edge
 * and not client-spoofable), then the RIGHTMOST `x-forwarded-for` hop
 * (appended by the last trusted proxy, unlike the client-controlled
 * leftmost). Falls back to "unknown".
 */
export function clientIpFromHeaders(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
  return "unknown";
}
