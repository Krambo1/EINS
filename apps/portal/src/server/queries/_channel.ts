import { sql } from "drizzle-orm";
import { schema } from "@/db/client";
import { reportingChannel, type ReportingChannel } from "@/lib/sources";

/**
 * SQL grouping keys that carry everything reportingChannel() reads from a
 * request, so reports can aggregate in Postgres and still classify through the
 * one typed function in lib/sources.ts. Group by `source` plus these keys,
 * then fold the groups with channelOfGroup().
 */
export const channelKeys = {
  source: schema.requests.source,
  utmSource: sql<string | null>`${schema.requests.utm}->>'utm_source'`,
  utmMedium: sql<string | null>`${schema.requests.utm}->>'utm_medium'`,
  googleClick: sql<boolean>`coalesce(jsonb_typeof(${schema.requests.utm}) = 'object' AND ${schema.requests.utm} ?| array['gclid','wbraid','gbraid'], false)`,
  // CASE, not AND: jsonb_object_keys raises on a non-object and Postgres does
  // not promise short-circuit evaluation of AND.
  anyUtm: sql<boolean>`CASE WHEN jsonb_typeof(${schema.requests.utm}) = 'object' THEN EXISTS (SELECT 1 FROM jsonb_object_keys(${schema.requests.utm}) k WHERE left(k, 4) = 'utm_') ELSE false END`,
};

export const channelGroupBy = [
  channelKeys.source,
  channelKeys.utmSource,
  channelKeys.utmMedium,
  channelKeys.googleClick,
  channelKeys.anyUtm,
] as const;

export interface ChannelGroup {
  source: string;
  utmSource: string | null;
  utmMedium: string | null;
  googleClick: boolean;
  anyUtm: boolean;
}

export function channelOfGroup(r: ChannelGroup): ReportingChannel {
  const utm: Record<string, string> = {};
  if (r.utmSource) utm.utm_source = r.utmSource;
  if (r.utmMedium) utm.utm_medium = r.utmMedium;
  if (r.googleClick) utm.gclid = "1";
  // Any other utm_* key only decides "unbekannt" vs "direkt".
  if (r.anyUtm && !r.utmSource && !r.utmMedium) utm.utm_campaign = "1";
  return reportingChannel({ source: r.source, utm });
}
