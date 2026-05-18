import "server-only";
import { cookies } from "next/headers";

export const ACTION_FLASH_COOKIE = "eins_action_flash";

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

/** Convert a thrown value into a user-readable German message. */
export function flashMessageFromError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Aktion fehlgeschlagen. Bitte erneut versuchen.";
}
