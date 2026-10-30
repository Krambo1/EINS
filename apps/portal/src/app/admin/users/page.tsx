import { requireAdmin } from "@/auth/admin-guards";
import { adminAllUsers } from "@/server/queries/admin";
import { UsersBoard } from "./_components/UsersBoard";

export const metadata = { title: "Nutzer · Admin" };

export default async function AdminUsersPage() {
  await requireAdmin();
  // Every account once: UsersBoard filters in the browser.
  const all = await adminAllUsers();
  return <UsersBoard all={all} />;
}
