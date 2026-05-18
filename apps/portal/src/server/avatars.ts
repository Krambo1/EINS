import "server-only";
import { getStorage } from "./storage";

/**
 * Resolve an avatar storage key into a browser-fetchable URL.
 *
 * The database persists only the opaque storage key (e.g.
 * `avatars/<userId>.webp`); the URL is computed at read time so the bucket
 * domain isn't baked into the data. `updatedAt` becomes a `?v=<unix-ms>`
 * cache-buster so the new image shows up immediately after an upload —
 * crucial when overwriting the same key (otherwise CDNs / browsers serve
 * the previous bytes).
 *
 * Returns null when the storage driver can't produce a public URL without
 * presigning (R2 without `R2_PUBLIC_BASE`). Callers fall back to initials.
 * If we ever need signed avatar URLs we'd switch this to async and trade
 * a per-render signing call for the bucket being non-public.
 */
export function avatarUrlForKey(
  key: string | null | undefined,
  updatedAt: Date | null | undefined
): string | null {
  if (!key) return null;
  const base = getStorage().publicUrlFor(key);
  if (!base) return null;
  if (!updatedAt) return base;
  return `${base}${base.includes("?") ? "&" : "?"}v=${updatedAt.getTime()}`;
}
