import "server-only";
import { requireSession } from "@/auth/guards";
import { getNavBadges } from "@/server/queries/navBadgesCache";
import type { Role } from "@/lib/constants";
import { PortalShellClient, type PortalShellProps } from "./PortalShellClient";

/**
 * Server half of the portal shell. The (portal) layout renders this with the
 * same props as before; here we add the two sidebar facts the layout does not
 * pass on its own:
 *
 *  - new requests and due Wiedervorlagen as separate numbers, so the
 *    "Anfragen" entry can show two pills instead of "4 neu · 1 fällig" in one;
 *  - whether "Werbebudget" belongs in the sidebar yet (ad account connected or
 *    campaign data present; organic start hides it, the page stays reachable).
 *
 * No extra database work: `getSession` and `getNavBadges` are wrapped in
 * React `cache()` and the layout already called both with the same arguments
 * in this request, so these calls return the memoized results.
 */
export async function PortalShell(props: Omit<PortalShellProps, "anfragenDue" | "showWerbebudget">) {
  const session = await requireSession();
  const badges = await getNavBadges(
    session.clinicId,
    session.userId,
    session.role as Role
  );
  return (
    <PortalShellClient
      {...props}
      navBadgeCounts={{
        ...props.navBadgeCounts,
        "/anfragen": badges.newRequests,
      }}
      anfragenDue={badges.dueFollowups}
      showWerbebudget={badges.hasAdData}
    />
  );
}
