/**
 * Signed-out pages sit inside admin/loading.tsx, whose dashboard skeleton
 * would flash inside the sign-in card while this page renders. This closer
 * boundary catches the wait instead and shows the empty card.
 */
export default function Loading() {
  return null;
}
