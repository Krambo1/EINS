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

    DATABASE_URL: z.string().min(1),
    DATABASE_URL_APP: z.string().min(1).optional(),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

    SESSION_SECRET: z
      .string()
      .min(32, "SESSION_SECRET must be at least 32 characters"),
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 32 bytes hex (64 chars)"),

    // Email
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("EINS Visuals <portal@einsvisuals.com>"),
    EMAIL_DRIVER: z.enum(["console", "resend", "mailhog"]).default("console"),

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

    // Google
    GOOGLE_ADS_CLIENT_ID: z.string().optional(),
    GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
    GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),

    // Sentry
    SENTRY_DSN: z.string().optional(),

    // Admin
    ADMIN_EMAILS: z
      .string()
      .default("karam@einsvisuals.com")
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
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_APP: process.env.DATABASE_URL_APP,
    REDIS_URL: process.env.REDIS_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_DRIVER: process.env.EMAIL_DRIVER,
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
    GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
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
