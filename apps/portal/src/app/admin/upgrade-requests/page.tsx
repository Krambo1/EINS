import { redirect } from "next/navigation";

/**
 * Legacy route — content moved into /admin/operations#upgrades.
 * Kept as a 308 redirect so external bookmarks still resolve.
 */
export default function UpgradeRequestsRedirect() {
  redirect("/admin/operations#upgrades");
}
