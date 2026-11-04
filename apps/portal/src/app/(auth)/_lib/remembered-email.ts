"use client";

/**
 * The address typed on one sign-in screen, carried to the next one in this
 * browser, so nobody types it twice ("Passwort vergessen?" and back, the next
 * visit). Never in the URL: an address in a query string ends up in logs and
 * the history.
 *
 * - `tab` (sessionStorage): what is in the field right now, for the screens
 *   of this one tab. Gone when the tab closes.
 * - `last` (localStorage): the address of the last sign-in attempt on this
 *   device, so the next visit starts at the password (Microsoft, Google).
 *
 * Every access sits in try/catch: private modes and blocked storage throw,
 * and then the field is simply empty, as before.
 */
const TAB_KEY = "eins-auth-email";
const LAST_KEY = "eins-last-email";

function read(store: () => Storage, key: string): string {
  try {
    return store().getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function write(store: () => Storage, key: string, value: string) {
  try {
    const v = value.trim();
    if (v) store().setItem(key, v);
    else store().removeItem(key);
  } catch {
    // Storage blocked: nothing to carry over.
  }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

/** The address typed in this tab, else the one used last on this device. */
export function readRememberedEmail(): { email: string; fromLastLogin: boolean } {
  const tab = read(session, TAB_KEY);
  if (tab) return { email: tab, fromLastLogin: false };
  const last = read(local, LAST_KEY);
  return { email: last, fromLastLogin: last !== "" };
}

/** Keeps the field's current value for the other screens of this tab. */
export function rememberTypedEmail(email: string) {
  write(session, TAB_KEY, email);
}

/** After a sign-in attempt: the address the next visit starts with. */
export function rememberLastEmail(email: string) {
  write(local, LAST_KEY, email);
}
