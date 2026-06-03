import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Validated environment surface.
 *
 * Local-first philosophy: every external service is optional. If a credential
 * is missing, the portal falls back to a safe dev adapter (console email,
 * local storage, heuristic AI scorer).
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ORIGIN: z.string().url().default("http://localhost:3001"),
    /**
     * Origin for admin-host URLs (admin magic-links, password reset). The
     * middleware host-gates `/admin/*` off any non-admin host, so admin
     * emails MUST be issued against the admin host or they 404 on click.
     * If unset, we derive it from APP_ORIGIN by prepending `admin.`; see
     * `adminOrigin()` below.
     */
    ADMIN_ORIGIN: z.string().url().optional(),
    /**
     * Default clinic-landing origin used when a clinic has not set
     * `reviewLandingOrigin`. Patient review-request emails embed rating
     * links of the form `${origin}/r/${token}`.
     */
    CLINIC_LANDING_ORIGIN: z.string().url().default("http://localhost:3002"),

    DATABASE_URL: z.string().min(1),
    DATABASE_URL_APP: z.string().min(1).optional(),
    /**
     * Direct (unpooled, session-mode) Postgres URL for the pg-boss queue.
     * pg-boss keeps long-lived workers and runs advisory-lock maintenance, so
     * it must NOT go through a transaction-mode pooler (e.g. Neon's `-pooler`
     * endpoint or PgBouncer). Falls back to DATABASE_URL when unset — fine for
     * local dev where there is no pooler. See `bossConnectionString()`.
     */
    DATABASE_URL_DIRECT: z.string().min(1).optional(),

    SESSION_SECRET: z
      .string()
      .min(32, "SESSION_SECRET must be at least 32 characters"),
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 32 bytes hex (64 chars)"),

    // Email
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("EINS <team@eins.ag>"),
    EMAIL_DRIVER: z.enum(["console", "resend", "mailhog"]).default("console"),
    /**
     * Public URL for the EINS wordmark PNG referenced in every email layout.
     * Defaults to `${APP_ORIGIN}/eins-logo.png`, but in dev APP_ORIGIN is
     * `http://localhost:3001` which Gmail / Apple Mail / Outlook image
     * proxies cannot reach, so the logo renders as a broken-image
     * placeholder. Override this in `.env.local` (and prod) with a public
     * URL like `https://eins.ag/eins-logo.png` so the image actually loads.
     */
    EMAIL_LOGO_URL: z.string().url().optional(),

    // Storage
    STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    R2_PUBLIC_BASE: z.string().optional(),

    // OpenAI
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-4o-mini"),
    OPENAI_PROMPT_VERSION: z.string().default("v1"),

    // Meta
    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    META_REDIRECT_URI: z.string().url().optional(),
    META_API_VERSION: z.string().default("v21.0"),
    /**
     * Verify token Meta sends in the GET hub.verify_token query param when
     * subscribing the webhook. We pick a random long string per environment
     * and paste it into both the App dashboard and this env var. Any plain
     * string ≥ 32 chars is fine; do NOT reuse META_APP_SECRET.
     */
    META_LEADGEN_VERIFY_TOKEN: z.string().optional(),

    /**
     * Resend webhook signing secret (issued in the Resend dashboard alongside
     * the webhook URL). Verifies `Svix-Signature` on /api/webhooks/resend
     * payloads so a hostile sender can't forge bounces/complaints into our
     * suppression list. Format: `whsec_<base64>`.
     */
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    /**
     * Reply-To header for all outbound mail. Set to a monitored inbox
     * (e.g. `support@eins.ag`) so a patient hitting Reply on a review
     * invite or magic-link doesn't bounce at the From address.
     */
    EMAIL_REPLY_TO: z.string().email().optional(),

    // Google
    GOOGLE_ADS_CLIENT_ID: z.string().optional(),
    GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
    GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),
    /** Server-side API key for Places API (New) — review rating + count sync. */
    GOOGLE_PLACES_API_KEY: z.string().optional(),

    // Sentry
    SENTRY_DSN: z.string().optional(),

    // Admin
    ADMIN_EMAILS: z
      .string()
      .default("team@eins.ag")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      ),
    ADMIN_IP_ALLOWLIST: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),

    FEATURES: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3001"),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    APP_ORIGIN: process.env.APP_ORIGIN,
    ADMIN_ORIGIN: process.env.ADMIN_ORIGIN,
    CLINIC_LANDING_ORIGIN: process.env.CLINIC_LANDING_ORIGIN,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_APP: process.env.DATABASE_URL_APP,
    DATABASE_URL_DIRECT: process.env.DATABASE_URL_DIRECT,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_DRIVER: process.env.EMAIL_DRIVER,
    EMAIL_LOGO_URL: process.env.EMAIL_LOGO_URL,
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_PUBLIC_BASE: process.env.R2_PUBLIC_BASE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_PROMPT_VERSION: process.env.OPENAI_PROMPT_VERSION,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_REDIRECT_URI: process.env.META_REDIRECT_URI,
    META_API_VERSION: process.env.META_API_VERSION,
    META_LEADGEN_VERIFY_TOKEN: process.env.META_LEADGEN_VERIFY_TOKEN,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO,
    GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_IP_ALLOWLIST: process.env.ADMIN_IP_ALLOWLIST,
    FEATURES: process.env.FEATURES,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});

/**
 * Connection string for the pg-boss queue (both the producer singleton in
 * `server/jobs.ts` and the worker boss in `worker/connection.ts`). Prefers the
 * direct/session-mode endpoint when set so pg-boss's long-lived workers and
 * advisory-lock maintenance don't run through a transaction-mode pooler.
 */
export function bossConnectionString(): string {
  return env.DATABASE_URL_DIRECT ?? env.DATABASE_URL;
}

/**
 * Origin for admin-host URLs. Prefer `ADMIN_ORIGIN` if set; otherwise derive
 * by prepending `admin.` to the APP_ORIGIN host (stripping any existing
 * `admin.` first to avoid stacking). Used by admin magic-link and admin
 * password-reset email URLs: the middleware host-gates `/admin/*` off the
 * non-admin host, so issuing those URLs against APP_ORIGIN 404s on click.
 */
export function adminOrigin(): string {
  if (env.ADMIN_ORIGIN) return env.ADMIN_ORIGIN.replace(/\/$/, "");
  const u = new URL(env.APP_ORIGIN);
  const bareHost = u.host.replace(/^admin\./i, "");
  return `${u.protocol}//admin.${bareHost}`;
}

/**
 * Public URL for the EINS wordmark used in transactional emails. Falls back
 * to `${APP_ORIGIN}/eins-logo.png`, but APP_ORIGIN in dev is localhost which
 * Gmail / Apple Mail image proxies cannot reach. Set EMAIL_LOGO_URL in
 * `.env.local` (and prod) to a publicly reachable URL.
 */
export function emailLogoUrl(): string {
  if (env.EMAIL_LOGO_URL) return env.EMAIL_LOGO_URL;
  return `${env.APP_ORIGIN}/eins-logo.png`;
}

/**
 * Sibling URL for the rounded rating-star SVG used in the review-request
 * email. Derives from EMAIL_LOGO_URL when set (same hosting bucket) and
 * falls back to APP_ORIGIN for local dev. If you point EMAIL_LOGO_URL at a
 * CDN, make sure star-rating.svg is uploaded alongside eins-logo.png.
 */
export function emailStarUrl(): string {
  if (env.EMAIL_LOGO_URL) {
    return env.EMAIL_LOGO_URL.replace(/[^/]+$/, "star-rating.svg");
  }
  return `${env.APP_ORIGIN}/star-rating.svg`;
}

export function hasOpenAI(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}
export function hasResend(): boolean {
  return env.EMAIL_DRIVER === "resend" && Boolean(env.RESEND_API_KEY);
}
export function hasR2(): boolean {
  return (
    env.STORAGE_DRIVER === "r2" &&
    Boolean(env.R2_ACCESS_KEY_ID) &&
    Boolean(env.R2_SECRET_ACCESS_KEY) &&
    Boolean(env.R2_BUCKET)
  );
}
export function hasMeta(): boolean {
  return Boolean(env.META_APP_ID) && Boolean(env.META_APP_SECRET);
}
export function hasGoogle(): boolean {
  return (
    Boolean(env.GOOGLE_ADS_CLIENT_ID) &&
    Boolean(env.GOOGLE_ADS_CLIENT_SECRET) &&
    Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN)
  );
}
export function hasGooglePlaces(): boolean {
  return Boolean(env.GOOGLE_PLACES_API_KEY);
}

/**
 * Sanity-check the env on first import. Catches config combinations that
 * silently break flows that would otherwise look healthy in dev.
 *
 * Idempotent — module-level state guarantees this only fires once per
 * process. Warnings only; never throws (env errors should fail loud at
 * the @t3-oss/env-nextjs level, not here).
 */
function warnSuspiciousEnv(): void {
  // EMAIL_DRIVER=resend with APP_ORIGIN pointing at admin.* breaks every
  // clinic magic-link in dev: the middleware host-gates /api/auth/callback
  // off the admin host, so links emailed to clinic users 404 when clicked.
  // The fix is config: APP_ORIGIN must be the clinic host (typically
  // http://localhost:3001) and ADMIN_ORIGIN (if separated) the admin one.
  try {
    const origin = env.APP_ORIGIN ?? "";
    if (
      env.NODE_ENV !== "production" &&
      env.EMAIL_DRIVER === "resend" &&
      /^https?:\/\/admin\./i.test(origin)
    ) {
      console.warn(
        "[env] EMAIL_DRIVER=resend + APP_ORIGIN=" +
          origin +
          " — clinic magic-link URLs will be emitted with the admin host " +
          "and 404 against the middleware host-gate. Switch APP_ORIGIN to " +
          "the clinic host (e.g. http://localhost:3001) for dev."
      );
    }
    // Resend's shared sandbox sender. No DKIM/SPF/DMARC for eins.ag, shared
    // rate limits with every other Resend sandbox. Fine for dev; in prod
    // it'll silently land everything in spam.
    if (
      env.EMAIL_DRIVER === "resend" &&
      /@resend\.dev$/i.test(env.EMAIL_FROM ?? "")
    ) {
      console.warn(
        "[env] EMAIL_FROM=" +
          env.EMAIL_FROM +
          " is the Resend sandbox sender — no DKIM/SPF for your domain " +
          "and shared deliverability with every other Resend sandbox " +
          "tenant. Configure a verified sending domain before going live."
      );
    }
  } catch {
    // env may be skipping validation in some build contexts; ignore.
  }
}

warnSuspiciousEnv();
