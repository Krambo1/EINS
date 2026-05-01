import { redirect } from "next/navigation";

/**
 * Legacy route — content moved into /admin/operations#animationen.
 * Kept as a 308 redirect so external bookmarks still resolve.
 */
export default function AnimationsRedirect() {
  redirect("/admin/operations#animationen");
}
