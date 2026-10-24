import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Validated environment surface.
 *
 * Local-first philosophy: every external service is optional. If a credential
 * is missing, the portal falls back to a safe dev adapter (console email,
 * local storage, heuristic AI scorer).
 */
/**
 * V4 Neben 5: a full http: or https: URL. `URL.canParse` alone accepts
 * "localhost:3002" (scheme "localhost:") and "javascript:alert(1)".
 */
export function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol, host } = new URL(value);
  return (protocol === "http:" || protocol === "https:") && host.length > 0;
}

/** V4 Neben 4: minimum CRON_SECRET length in production (like VIDEO_API_TOKEN). */
export const MIN_CRON_SECRET_LENGTH = 32;

/**
 * Why the cron secret is unusable, or null. Missing anywhere, or shorter than
 * MIN_CRON_SECRET_LENGTH in production. Never stops the boot: the cron routes
 * answer 503 and productionConfigProblems() reports it.
 */
export function cronSecretProblem(
  raw: string | undefined,
  nodeEnv: string | undefined
): "missing" | "too_short" | null {
  const secret = raw?.trim() ?? "";
  if (!secret) return "missing";
  if (nodeEnv === "production" && secret.length < MIN_CRON_SECRET_LENGTH) return "too_short";
  return null;
}

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
      .min(32, "SESSION_SECRET must be at least 32 characters")
      // The .env.example placeholder is exactly 32 chars and would pass the
      // length check — a PROD deploy that ships it hands every signing context
      // a publicly-known key (pentest authn-01). Reject it in production; dev
      // may keep the placeholder so first-run onboarding stays frictionless.
      .refine(
        (v) =>
          process.env.NODE_ENV !== "production" || !/^change_me/i.test(v),
        "SESSION_SECRET is still the .env.example placeholder — generate a real secret (openssl rand -hex 32)"
      ),
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
    /**
     * L-3: separate private bucket for the nightly DB dump, optionally with
     * its own key pair (else the app pair). Unset: app bucket.
     */
    R2_BACKUP_BUCKET: z.string().optional(),
    R2_BACKUP_ACCESS_KEY_ID: z.string().optional(),
    R2_BACKUP_SECRET_ACCESS_KEY: z.string().optional(),
    /**
     * J-4: extra allowed origins for review links (own Praxis domains of
     * clinic-landing), comma-separated full URLs. CLINIC_LANDING_ORIGIN is
     * always allowed.
     */
    CLINIC_LANDING_ORIGINS: z
      .string()
      .optional()
      .refine(
        (v) =>
          !v ||
          v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .every(isHttpUrl),
        "CLINIC_LANDING_ORIGINS: comma-separated full http(s) URLs (https://...)"
      ),
    /** J-8: shared HMAC secret with clinic-landing for the relayed patient IP. */
    REVIEW_RELAY_SECRET: z.string().min(32).optional(),

    /**
     * Messweg webhooks (/api/webhooks/messweg/[provider], migration 0098).
     * Unset = that provider's webhook answers 503. MATELSO_WEBHOOK_TOKEN is
     * the shared token the Matelso Custom Push sends in the header
     * X-EINS-Messweg-Token; CALENDLY_WEBHOOK_SIGNING_KEY is the signing key
     * of the Calendly webhook subscription. MESSWEG_FIXTURE_SECRET signs the
     * test-only fixture provider (ignored in production).
     */
    MATELSO_WEBHOOK_TOKEN: z.string().min(32).optional(),
    CALENDLY_WEBHOOK_SIGNING_KEY: z.string().min(16).optional(),
    MESSWEG_FIXTURE_SECRET: z.string().min(16).optional(),

    /**
     * Outreach videos (0073). VIDEO_PUBLIC_ORIGIN is where the watch page is
     * served (the website app renders /v/<slug>); links shown in the admin
     * and returned by the API are built from it. VIDEO_API_TOKEN guards the
     * token API (/api/videos) that the outreach tooling uses to upload and to
     * read stats; unset means that API answers 404.
     */
    VIDEO_PUBLIC_ORIGIN: z.string().url().default("https://eins.ag"),
    VIDEO_API_TOKEN: z.string().min(32).optional(),

    /**
     * PVS vendor-config distribution (0071). PUBLIC keys only, as a JSON array:
     *   [{"keyId":"eins-pvs-2026a","publicKey":"<base64 raw Ed25519>"}]
     *
     * There is deliberately no private-key counterpart. A vendor config is SQL
     * that runs against Praxis patient databases, so signing happens offline
     * (apps/bridge/agent/scripts/sign-vendor-config.ts) and this app can only
     * verify. Unset means config uploads are refused, which is the correct
     * behaviour for an environment nobody has provisioned a key for.
     */
    PVS_CONFIG_PUBLIC_KEYS: z.string().optional(),

    /**
     * Bearer secret for the Vercel crons (/api/cron/daily, /api/cron/morning).
     * Optional for boot; unset, or shorter than MIN_CRON_SECRET_LENGTH in
     * production, means both cron routes answer 503, so
     * productionConfigProblems() reports it.
     */
    CRON_SECRET: z.string().optional(),
    /**
     * Single recipient for operator alerts (server/ops-alerts.ts) and the
     * failed new-request notice (server/request-notify.ts). Plain string, not
     * .email(): a typo must not stop the portal from booting.
     */
    OPS_ALERT_EMAIL: z.string().optional(),

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
    /** Google Ads REST version override (default in server/google-ads-oci.ts). */
    GOOGLE_ADS_API_VERSION: z.string().optional(),
    /** Server-side API key for Places API (New) — review rating + count sync. */
    GOOGLE_PLACES_API_KEY: z.string().optional(),
    /**
     * "Sign in with Google" OAuth client — DELIBERATELY separate from the
     * GOOGLE_ADS_* credentials above. This client only requests
     * `openid email profile` to authenticate clinic users + admins on the
     * login screens. When either value is missing, the "Mit Google anmelden"
     * button stays hidden (see `hasGoogleLogin()`), so an unconfigured env
     * never shows a broken button. Redirect URIs are derived from APP_ORIGIN /
     * adminOrigin() in `@/auth/google-login`, so no extra env var is needed.
     */
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

    // Admin
    // No default: a forgotten ADMIN_EMAILS must mean "no admin can log in"
    // (fail closed), not "silently trust a hardcoded address as admin
    // identity" (pentest Phase-2 residual #2). Empty list = admin login off.
    ADMIN_EMAILS: z
      .string()
      .default("")
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
    /**
     * Explicit opt-out of the production admin-IP-allowlist requirement. When
     * `ADMIN_IP_ALLOWLIST` is empty, admin login fails CLOSED in production
     * (pentest H1 / admin-04) UNLESS this is set to "1" — a documented, conscious
     * acceptance that the admin second factor is then email-allowlist + DB
     * session + password only (e.g. a dynamic-IP operator who cannot maintain an
     * allowlist). Do NOT set this without understanding the tradeoff.
     */
    ADMIN_IP_ALLOWLIST_DISABLED: z
      .enum(["0", "1"])
      .default("0")
      .transform((v) => v === "1"),
  },
  client: {},
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
    R2_BACKUP_BUCKET: process.env.R2_BACKUP_BUCKET,
    R2_BACKUP_ACCESS_KEY_ID: process.env.R2_BACKUP_ACCESS_KEY_ID,
    R2_BACKUP_SECRET_ACCESS_KEY: process.env.R2_BACKUP_SECRET_ACCESS_KEY,
    CLINIC_LANDING_ORIGINS: process.env.CLINIC_LANDING_ORIGINS,
    REVIEW_RELAY_SECRET: process.env.REVIEW_RELAY_SECRET,
    MATELSO_WEBHOOK_TOKEN: process.env.MATELSO_WEBHOOK_TOKEN,
    CALENDLY_WEBHOOK_SIGNING_KEY: process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
    MESSWEG_FIXTURE_SECRET: process.env.MESSWEG_FIXTURE_SECRET,
    VIDEO_PUBLIC_ORIGIN: process.env.VIDEO_PUBLIC_ORIGIN,
    VIDEO_API_TOKEN: process.env.VIDEO_API_TOKEN,
    PVS_CONFIG_PUBLIC_KEYS: process.env.PVS_CONFIG_PUBLIC_KEYS,
    CRON_SECRET: process.env.CRON_SECRET,
    OPS_ALERT_EMAIL: process.env.OPS_ALERT_EMAIL,
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
    GOOGLE_ADS_API_VERSION: process.env.GOOGLE_ADS_API_VERSION,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_IP_ALLOWLIST: process.env.ADMIN_IP_ALLOWLIST,
    ADMIN_IP_ALLOWLIST_DISABLED: process.env.ADMIN_IP_ALLOWLIST_DISABLED,
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
 * Whether "Sign in with Google" is configured. Gates the login-screen button
 * (clinic + admin) so an unconfigured environment never renders a button that
 * would dead-end at Google with an `invalid_client` error.
 */
export function hasGoogleLogin(): boolean {
  return (
    Boolean(env.GOOGLE_OAUTH_CLIENT_ID) &&
    Boolean(env.GOOGLE_OAUTH_CLIENT_SECRET)
  );
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(origin);
}

/**
 * Presence summary of the integrations, booleans only (never values). Public
 * in /api/health, so it must stay free of secrets, hosts and ids.
 */
export function configSummary(): Record<string, boolean> {
  return {
    appOrigin: !isLocalOrigin(env.APP_ORIGIN) && env.APP_ORIGIN.startsWith("https://"),
    clinicLandingOrigin: !isLocalOrigin(env.CLINIC_LANDING_ORIGIN),
    email: hasResend(),
    storage: hasR2(),
    openai: hasOpenAI(),
    meta: hasMeta(),
    google: hasGoogle(),
    googlePlaces: hasGooglePlaces(),
    googleLogin: hasGoogleLogin(),
    adminLogin: env.ADMIN_EMAILS.length > 0,
  };
}

/**
 * Production config that silently falls back to dev behaviour (A-11):
 * localhost links in emails, console instead of Resend, local disk instead
 * of R2. These are optional integrations by design, so the app still boots
 * (a missing Meta key must never take the portal down); instead each problem
 * is logged once per process at `level:error` and shows up in /api/health
 * under `config`. Empty outside production.
 */
export function productionConfigProblems(): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  const s = configSummary();
  if (!s.appOrigin) problems.push("APP_ORIGIN is localhost or not https: links in emails point nowhere");
  if (!s.clinicLandingOrigin) problems.push("CLINIC_LANDING_ORIGIN is localhost: patient review links point nowhere");
  if (!s.email) problems.push("email is not EMAIL_DRIVER=resend with RESEND_API_KEY: no email leaves the system");
  if (!s.storage) problems.push("storage is not STORAGE_DRIVER=r2 with keys and bucket: uploads cannot work on Vercel");
  const cron = cronSecretProblem(env.CRON_SECRET, env.NODE_ENV);
  if (cron === "missing") problems.push("CRON_SECRET is not set: /api/cron/daily and /api/cron/morning answer 503, nothing runs without the worker");
  if (cron === "too_short") problems.push(`CRON_SECRET is shorter than ${MIN_CRON_SECRET_LENGTH} characters: /api/cron/daily and /api/cron/morning answer 503 until it is replaced`);
  return problems;
}

function reportProductionConfigProblems(): void {
  // The build also imports this module with NODE_ENV=production; only the
  // running server should shout.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    for (const problem of productionConfigProblems()) {
      console.error(JSON.stringify({ kind: "config", level: "error", problem }));
    }
  } catch {
    // validation skipped in some build contexts; nothing to report.
  }
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
    // Admin-bootstrap surface checks (pentest authn-02 / residual #2):
    // an empty allowlist means the documented "second factor" for the
    // TOTP-less admin track is absent; an empty ADMIN_EMAILS means admin
    // login is dead (fail closed, but probably a forgotten env var).
    if (env.NODE_ENV === "production" && env.ADMIN_IP_ALLOWLIST.length === 0) {
      if (env.ADMIN_IP_ALLOWLIST_DISABLED) {
        console.warn(
          "[env] ADMIN_IP_ALLOWLIST is empty and ADMIN_IP_ALLOWLIST_DISABLED=1 " +
            "in production — admin login runs WITHOUT its IP second factor " +
            "(email allowlist + DB session + password only). Set the allowlist " +
            "to office/VPN IPs to restore it."
        );
      } else {
        console.warn(
          "[env] ADMIN_IP_ALLOWLIST is empty in production — admin login will " +
            "FAIL CLOSED (nobody can log in). Set ADMIN_IP_ALLOWLIST to the " +
            "office/VPN IPs, or ADMIN_IP_ALLOWLIST_DISABLED=1 to consciously " +
            "accept the weaker factor."
        );
      }
    }
    if (env.ADMIN_EMAILS.length === 0) {
      console.warn(
        "[env] ADMIN_EMAILS is empty — no admin login is possible. Set it " +
          "explicitly (there is deliberately no default)."
      );
    }
  } catch {
    // env may be skipping validation in some build contexts; ignore.
  }
}

warnSuspiciousEnv();
reportProductionConfigProblems();
