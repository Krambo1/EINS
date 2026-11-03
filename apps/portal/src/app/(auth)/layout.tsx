import type { ReactNode } from "react";

/**
 * Auth-flow layout for /login, /login/link, /forgot-password and
 * /set-password. It adds nothing: every page and every loading.tsx draws its
 * own AuthShell (frame, light tokens, security notes, shared with the admin
 * sign-in pages). Without JavaScript the streamed page stays in a hidden
 * block after the skeleton; holding the whole frame, it can replace the
 * skeleton's frame (loading.tsx) instead of landing below the card.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
