import type { ReactNode } from "react";
import { AuthShell } from "./_components/AuthShell";

/**
 * Auth-flow layout for /login, /login/link, /forgot-password and
 * /set-password. The frame (eins.ag look, light tokens, security notes)
 * lives in AuthShell, which the admin sign-in pages share.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
