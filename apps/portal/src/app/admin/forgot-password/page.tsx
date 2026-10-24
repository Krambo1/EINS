import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Admin-Passwort vergessen" };

// The frame (logo, "Admin" badge, card) comes from admin/layout.tsx.
export default function AdminForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
