/**
 * Sidebar pill for "Anfragen": the unread count as before, plus the number
 * of due Wiedervorlagen (C-20) so an Inhaberin without a Frontdesk user sees
 * her planned callbacks. Number = unchanged pill ("3"), string = rendered as
 * is by PortalShell.
 */
export function anfragenNavBadge(newRequests: number, dueFollowups: number): number | string {
  if (dueFollowups <= 0) return newRequests;
  const due = `${dueFollowups > 99 ? "99+" : dueFollowups} fällig`;
  if (newRequests <= 0) return due;
  return `${newRequests > 99 ? "99+" : newRequests} neu · ${due}`;
}
