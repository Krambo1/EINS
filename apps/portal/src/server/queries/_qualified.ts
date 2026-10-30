import { and, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db/client";
import { MESSWEG_SOURCE_VALUES } from "@/lib/sources";

/**
 * A qualifizierte Anfrage, the unit of "Kosten je qualifizierter Anfrage"
 * (contract 2.11): it came in through an EINS-Messweg, it has a phone number
 * or an e-mail address (Garantie-Anhang § 2 Abs. (1), lib/guarantee-clock.ts
 * K-2), and the Praxis has not marked it as spam. Duplicates within 30 days,
 * applications and sales pitches are judged by the Praxis (status Spam), not
 * here. Postgres boolean over `requests`, for WHERE and FILTER (WHERE ...).
 */
export const qualifiedRequest: SQL = and(
  ne(schema.requests.status, "spam"),
  inArray(sql`lower(btrim(${schema.requests.source}))`, [...MESSWEG_SOURCE_VALUES]),
  or(
    sql`btrim(coalesce(${schema.requests.contactPhone}, '')) <> ''`,
    sql`btrim(coalesce(${schema.requests.contactEmail}, '')) <> ''`
  )
)!;

/** count(*) of the qualifizierte Anfragen in a grouped select. */
export const qualifiedCount = sql<number>`count(*) FILTER (WHERE ${qualifiedRequest})::int`;

/** Werbebudget ÷ qualifizierte Anfragen; null without Werbebudget or without one. */
export function costPerQualified(spendEur: number | null, qualified: number): number | null {
  return spendEur != null && spendEur > 0 && qualified > 0
    ? Number((spendEur / qualified).toFixed(2))
    : null;
}
