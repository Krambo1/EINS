import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Bell notification for the Inhaber:innen when an ad-platform connection
 * needs action (E-09, E-29). Deduplicated in SQL: at most one unread-or-recent
 * notification of the same kind per user within `dedupeDays`, so a check that
 * runs every 15 minutes (worker) or daily (cron) never floods the bell.
 *
 * No patient data involved; text is fixed copy.
 */
export async function notifyOwnersOnce(opts: {
  clinicId: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  dedupeDays: number;
}): Promise<number> {
  const rows = (await db.execute(sql`
    INSERT INTO notifications (user_id, clinic_id, kind, title, body, link)
    SELECT u.id, u.clinic_id, ${opts.kind}, ${opts.title}, ${opts.body}, ${opts.link}
      FROM clinic_users u
     WHERE u.clinic_id = ${opts.clinicId}
       AND u.role = 'inhaber'
       AND u.archived_at IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM notifications n
              WHERE n.user_id = u.id
                AND n.kind = ${opts.kind}
                AND n.created_at > now() - (${opts.dedupeDays}::int * interval '1 day')
           )
    RETURNING id
  `)) as unknown as unknown[];
  return rows.length;
}

export const GOOGLE_RECONNECT = {
  kind: "google_connection_broken",
  title: "Google-Verbindung unterbrochen",
  body: "Die Werbedaten von Google kommen seit einiger Zeit nicht mehr an. Bitte verbinden Sie Google in den Einstellungen erneut.",
  link: "/einstellungen#integrationen",
} as const;
