import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __einsPgSuper: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __einsPgApp: ReturnType<typeof postgres> | undefined;
}

function superClient() {
  if (!globalThis.__einsPgSuper) {
    globalThis.__einsPgSuper = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => void 0,
    });
  }
  return globalThis.__einsPgSuper;
}

function appClient() {
  const url = env.DATABASE_URL_APP ?? env.DATABASE_URL;
  if (!globalThis.__einsPgApp) {
    globalThis.__einsPgApp = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => void 0,
    });
  }
  return globalThis.__einsPgApp;
}

/** Drizzle instance bound to the superuser connection (bypasses RLS). */
export const db = drizzle(superClient(), { schema });

/** Drizzle instance bound to the RLS-enforced app role. */
export const dbApp = drizzle(appClient(), { schema });

export const sqlClient = superClient();
export const sqlClientApp = appClient();

/**
 * Run `fn` inside a transaction with Postgres session variables set
 * so RLS policies resolve correctly. Session vars use `set_config(..., true)`
 * (transaction-scoped) so they do NOT leak between pooled connections.
 */
export async function withClinicContext<T>(
  clinicId: string,
  userId: string | null,
  fn: (tx: typeof dbApp) => Promise<T>
): Promise<T> {
  return await dbApp.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT
        set_config('app.current_clinic_id', ${clinicId}, true),
        set_config('app.current_user_id', ${userId ?? ""}, true)
    `);
    return await fn(tx as unknown as typeof dbApp);
  });
}

export { schema };
