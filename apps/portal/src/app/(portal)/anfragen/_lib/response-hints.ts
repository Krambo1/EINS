import { SLA_HOURS } from "@/lib/constants";

/**
 * Short explanations for the red markers (DS3 item 5). One place, used as
 * popover text where the marker is not inside a link and as `title` where it
 * is (a button inside a row link would be invalid and would navigate).
 */

/** Internal response target ("Überfällig"), see `SLA_HOURS`. No contract consequence. */
export const OVERDUE_HINT = `Ziel der Praxis: Rückmeldung innerhalb von ${SLA_HOURS} Stunden nach Eingang. Eine schnelle Antwort erhöht die Chance auf einen Termin. Dieses Ziel hat keine Folgen für Vertrag oder Garantie.`;

/**
 * KANON 6a, "nicht beantwortet": no contact attempt within 48 Werkstunden.
 * The three consequences in KANON wording, nothing added.
 */
export const NOT_ANSWERED_HINT =
  'Innerhalb von 48 Werkstunden (Montag bis Freitag, 9 bis 18 Uhr, ohne Feiertage) gab es keinen Kontaktversuch. Das ist keine Bedingung der Garantie, hat aber drei Folgen: Sie können bei dieser Anfrage nicht mehr einwenden, die Person sei nicht echt oder nicht erreichbar gewesen. Die Anfrage steht in Ihrer Auswertung als "von der Praxis nicht beantwortet". Und liegen drei oder mehr solcher Anfragen offen, dürfen wir nach einer Warnung die bezahlten Anzeigen pausieren, bis Sie die Anfragen kontaktiert haben.';

/**
 * KANON 6a, "zu spät beantwortet": attempt after the deadline. Only Folge 1
 * and 2 apply (Folge 3 counts open inquiries without any attempt).
 */
export const LATE_HINT =
  'Der erste Kontaktversuch kam nach Ablauf der 48 Werkstunden (Montag bis Freitag, 9 bis 18 Uhr, ohne Feiertage). Das ist keine Bedingung der Garantie, hat aber zwei Folgen: Sie können bei dieser Anfrage nicht mehr einwenden, die Person sei nicht echt oder nicht erreichbar gewesen. Und die Anfrage steht in Ihrer Auswertung als "von der Praxis zu spät beantwortet".';

/** Running deadline: what counts as a contact attempt (KANON 6a). */
export const DEADLINE_RUNNING_HINT =
  "Bitte versuchen Sie, die Anfrage bis zu dieser Zeit zu kontaktieren. Es zählen 48 Werkstunden (Montag bis Freitag, 9 bis 18 Uhr, ohne Feiertage). Jeder protokollierte Anruf, auch ohne Erreichen, und jede vermerkte Nachricht zählt als Kontaktversuch.";
