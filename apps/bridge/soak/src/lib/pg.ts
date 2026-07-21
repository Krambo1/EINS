import pg from "pg";

/**
 * Minimal pg helpers. Every call opens a fresh client — the harness runs for
 * days, and a long-lived pooled connection is one more thing chaos (or a
 * Postgres restart) can wedge. Connection setup cost is irrelevant at soak
 * op rates.
 */

export async function withClient<T>(
  url: string,
  fn: (c: pg.Client) => Promise<T>
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function query(
  url: string,
  sql: string,
  params: unknown[] = []
): Promise<pg.QueryResult> {
  return withClient(url, (c) => c.query(sql, params));
}
