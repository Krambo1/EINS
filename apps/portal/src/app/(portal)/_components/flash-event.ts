/**
 * Opens the portal toast (ActionFlashToast) from a client component, for
 * actions that return a result instead of setting the flash cookie. The
 * toast floats, so a confirmation never changes the size of the card it
 * came from (DESIGN.md section 10, "Fixed size").
 */
export const ACTION_FLASH_EVENT = "eins:action-flash";

export type ClientFlash = {
  tone: "good" | "bad";
  title: string;
  description?: string;
  /** One button in the toast, e.g. "Rückgängig" after taking someone off a list. */
  action?: { label: string; onClick: () => void };
};

export function showActionFlash(flash: ClientFlash): void {
  window.dispatchEvent(new CustomEvent<ClientFlash>(ACTION_FLASH_EVENT, { detail: flash }));
}
