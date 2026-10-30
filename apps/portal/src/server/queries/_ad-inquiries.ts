import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { schema, type dbApp } from "@/db/client";
import { adPlatformFor } from "@/lib/sources";
import { channelGroupBy, channelKeys, channelOfGroup } from "./_channel";
import { qualifiedCount } from "./_qualified";

type Tx = typeof dbApp;

export interface AdInquiryDay {
  /** Berlin calendar date "YYYY-MM-DD". */
  date: string;
  platform: "meta" | "google";
  /** Anfragen from the platform's ads, spam excluded. */
  inquiries: number;
  /** Of those, the qualifizierte Anfragen (_qualified.ts): the unit of the cost per Anfrage. */
  qualified: number;
  /** Of those, the ones that got a Termin or went further, counted as the Trichter counts Termine. */
  appointments: number;
  /** Of those, the gewonnene Behandlungen. */
  won: number;
  /** Umsatz of the won ones: the only Umsatz the Werbeertrag divides by the Werbebudget. */
  revenueEur: number;
}

/**
 * Anfragen per Berlin day that came in through a Meta or Google ad, counted
 * in the portal with the same channel rule as the Quellen (bySource,
 * reportingChannel), in [start, endExclusive). The Werbebudget page and the
 * Trichter divide the Werbebudget by `qualified`, so every page agrees.
 */
export async function adInquiriesByDay(
  tx: Tx,
  clinicId: string,
  start: Date,
  endExclusive: Date
): Promise<AdInquiryDay[]> {
  const berlinDate = sql<string>`to_char((${schema.requests.createdAt} AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD')`;
  const rows = await tx
    .select({
      ...channelKeys,
      date: berlinDate,
      inquiries: sql<number>`count(*)::int`,
      qualified: qualifiedCount,
      appointments: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} IN ('termin_vereinbart','beratung_erschienen','behandelt','gewonnen'))::int`,
      won: sql<number>`count(*) FILTER (WHERE ${schema.requests.status} = 'gewonnen')::int`,
      revenueEur: sql<number>`coalesce(sum(${schema.requests.convertedRevenueEur}) FILTER (WHERE ${schema.requests.status} = 'gewonnen'), 0)::float8`,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        ne(schema.requests.status, "spam"),
        gte(schema.requests.createdAt, start),
        lt(schema.requests.createdAt, endExclusive)
      )
    )
    .groupBy(...channelGroupBy, berlinDate);

  const byDay = new Map<string, AdInquiryDay>();
  for (const r of rows) {
    const platform = adPlatformFor(channelOfGroup(r));
    if (!platform) continue;
    const key = `${platform}|${r.date}`;
    const day = byDay.get(key) ?? {
      date: r.date,
      platform,
      inquiries: 0,
      qualified: 0,
      appointments: 0,
      won: 0,
      revenueEur: 0,
    };
    day.inquiries += Number(r.inquiries);
    day.qualified += Number(r.qualified);
    day.appointments += Number(r.appointments);
    day.won += Number(r.won);
    day.revenueEur += Number(r.revenueEur);
    byDay.set(key, day);
  }
  return Array.from(byDay.values());
}
