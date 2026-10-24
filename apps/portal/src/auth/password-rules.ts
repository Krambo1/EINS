/**
 * Passwort-Regeln ohne Server-Abhängigkeiten.
 *
 * Einzige Quelle für die Policy-Zahlen und die Zeichenarten-Zählung: der
 * Server prüft damit in `checkPasswordPolicy` (@/auth/password), die
 * Set-Password-Seite zeigt damit live an, welche Regel schon erfüllt ist. Die
 * Anzeige im Browser ist nur eine Hilfe, verbindlich bleibt die Prüfung auf
 * dem Server.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
export const PASSWORD_MIN_CLASSES = 3;

/**
 * Zählt, wie viele der vier Klassen (Groß / Klein / Ziffer / Sonderzeichen)
 * im Passwort vorkommen. Umlaute zählen zu Groß/Klein; alles außerhalb von
 * ASCII-Buchstaben + Umlauten + Ziffern gilt als Sonderzeichen (inklusive
 * Leerzeichen und Unicode-Symbolen).
 */
export function countCharacterClasses(input: string): number {
  let n = 0;
  if (/[A-ZÄÖÜ]/.test(input)) n++;
  if (/[a-zäöüß]/.test(input)) n++;
  if (/[0-9]/.test(input)) n++;
  if (/[^A-Za-zÄÖÜäöüß0-9]/.test(input)) n++;
  return n;
}
