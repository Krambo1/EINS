import { Button } from "@eins/ui";

interface Props {
  targetUserId: string;
  /** Shown on hover for clarity in the table. */
  targetEmail: string;
}

/**
 * "Als Benutzer öffnen" — opens the clinic portal in a new tab as the
 * given user via an admin-issued impersonation token.
 *
 * This is a real `<form target="_blank" method="POST">`, not a JS-driven
 * `window.open()`. Two reasons:
 *
 *   1. Browser popup blockers only honor `window.open()` synchronously
 *      inside a user-gesture event. Awaiting a server action first
 *      forfeits that grant and the popup gets silently blocked. A form
 *      submit IS a native gesture-driven navigation, no grant needed.
 *
 *   2. The previous implementation passed `"noopener"` to `window.open`
 *      and then null-checked the return value — but per spec, `noopener`
 *      makes `window.open()` return null on success, so the "Popup
 *      blockiert" branch fired on every click whether or not the popup
 *      had actually opened.
 *
 * The handler at `/admin/start-impersonation` mints the one-time token
 * and 303-redirects the new tab to the clinic-host consumer endpoint.
 */
export function ImpersonateButton({ targetUserId, targetEmail }: Props) {
  return (
    <form
      action="/admin/start-impersonation"
      method="POST"
      target="_blank"
      rel="noopener noreferrer"
      className="flex justify-end"
    >
      <input type="hidden" name="targetUserId" value={targetUserId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        title={`Portal als ${targetEmail} öffnen`}
      >
        Als Benutzer öffnen
      </Button>
    </form>
  );
}
