import "server-only";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { ForbiddenError } from "@/lib/roles";
import { ImpersonationBlockedError } from "@/auth/impersonation-guard";
import { describeErrorForLog, isDbDriverError } from "@/lib/error-log";
import { ACTION_FLASH_COOKIE } from "@/lib/flash-cookie";
import { EmailDeliveryError } from "@/lib/email-delivery-error";

export { ACTION_FLASH_COOKIE };

export type FlashTone = "good" | "bad";

export type FlashPayload = {
  /** Monotonic id so client re-fires the toast even when the message text repeats. */
  id: string;
  tone: FlashTone;
  title: string;
  description?: string;
};

type FlashInput = Omit<FlashPayload, "id"> | { title: string; tone: FlashTone; description?: string };

/** Drop a flash on the response so the next portal render shows a confirmation toast. */
export async function flash(payload: FlashInput): Promise<void> {
  const jar = await cookies();
  const value: FlashPayload = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    tone: payload.tone,
    title: payload.title,
    description: payload.description,
  };
  jar.set(ACTION_FLASH_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30,
    path: "/",
  });
}

export async function flashSuccess(title: string, description?: string): Promise<void> {
  await flash({ tone: "good", title, description });
}

export async function flashError(title: string, description?: string): Promise<void> {
  await flash({ tone: "bad", title, description });
}

/**
 * Read the flash cookie. Called from the (portal) layout each render.
 *
 * Pure read — no mutation. Next 15 forbids cookie mutation from Server
 * Components, so middleware clears the cookie on the response instead
 * (see `src/middleware.ts`).
 */
export async function readActionFlash(): Promise<FlashPayload | null> {
  const jar = await cookies();
  const c = jar.get(ACTION_FLASH_COOKIE);
  if (!c) return null;
  try {
    const parsed = JSON.parse(c.value) as FlashPayload;
    if (!parsed || typeof parsed.title !== "string") return null;
    if (parsed.tone !== "good" && parsed.tone !== "bad") return null;
    return parsed;
  } catch {
    return null;
  }
}

const GENERIC_ERROR_MESSAGE =
  "Das hat gerade nicht geklappt. Bitte versuchen Sie es erneut.";

/**
 * Convert a thrown value into a user-readable German message.
 *
 * Only messages written for the user pass through: plain `Error`s thrown by
 * our own actions (`throw new Error("Diese E-Mail-Adresse ist bereits ...")`)
 * and `ImpersonationBlockedError`. Everything else (Postgres driver errors,
 * Zod issue dumps, TypeErrors, network errors from Resend/R2/Meta) gets a
 * generic German text, and the details go to the server log via
 * `describeErrorForLog` (no patient data). `action` labels the log line.
 */
export function flashMessageFromError(err: unknown, action?: string): string {
  if (err instanceof ForbiddenError) {
    return "Dafür fehlt Ihrer Rolle die Berechtigung.";
  }
  if (err instanceof ZodError) {
    return "Bitte prüfen Sie Ihre Eingaben.";
  }
  if (err instanceof ImpersonationBlockedError) return err.message;
  if (isUserFacingError(err)) return err.message;
  console.error(
    JSON.stringify({
      kind: "action_error",
      level: "error",
      action: action ?? "unknown",
      error: describeErrorForLog(err),
    })
  );
  return GENERIC_ERROR_MESSAGE;
}

/**
 * A plain `new Error("...")` from app code, i.e. not a subclass (TypeError,
 * PostgresError, ...), no driver/system `code`, no wrapped `cause`.
 * E-mail delivery failures (`EmailDeliveryError`, English provider text) are
 * never user-facing (V4 Neben 6); the explicit check keeps that true even if
 * the subclass rule below is ever loosened.
 */
function isUserFacingError(err: unknown): err is Error {
  if (!(err instanceof Error) || !err.message) return false;
  if (err instanceof EmailDeliveryError) return false;
  if (Object.getPrototypeOf(err) !== Error.prototype) return false;
  if (isDbDriverError(err)) return false;
  if ("code" in err || err.cause !== undefined) return false;
  return true;
}
