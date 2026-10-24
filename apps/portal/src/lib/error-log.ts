/**
 * Patient-data-safe description of a thrown value for server logs.
 *
 * Rules:
 *  - Postgres driver errors (postgres.js `PostgresError`, recognisable by a
 *    5-char SQLSTATE `code`) are logged by code / constraint / table only.
 *    Their `message` and `detail` can echo row values ("Key (email)=(...)",
 *    `invalid input syntax for type uuid: "<input>"`), so they never leave.
 *  - Any other message is truncated and scrubbed of e-mail addresses and long
 *    digit runs (phone numbers) before logging.
 *  - No stack: Vercel logs keep the digest, which is enough to correlate.
 *
 * Dependency-free so it can run from `instrumentation.ts` in any runtime.
 */

export type SafeErrorLog = {
  name: string;
  code?: string;
  constraint?: string;
  table?: string;
  message?: string;
  cause?: SafeErrorLog;
};

const SQLSTATE = /^[0-9A-Z]{5}$/;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function scrubMessage(message: string): string {
  return message
    .replace(/[^\s"'<>()]+@[^\s"'<>()]+\.[a-z]{2,}/gi, "<email>")
    .replace(/\+?\d[\d\s/().-]{6,}\d/g, "<number>")
    .slice(0, 200);
}

/** True for errors coming out of the Postgres driver (SQLSTATE code). */
export function isDbDriverError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  if (e.name === "PostgresError") return true;
  return typeof e.code === "string" && SQLSTATE.test(e.code) && "severity" in e;
}

export function describeErrorForLog(err: unknown, depth = 0): SafeErrorLog {
  if (!err || typeof err !== "object") {
    return { name: typeof err, message: scrubMessage(String(err)) };
  }
  const e = err as Record<string, unknown> & { name?: unknown; message?: unknown };
  const name = str(e.name) ?? "Error";
  if (isDbDriverError(err)) {
    return {
      name,
      code: str(e.code),
      constraint: str(e.constraint_name),
      table: str(e.table_name),
    };
  }
  const out: SafeErrorLog = { name };
  if (typeof e.code === "string") out.code = e.code.slice(0, 40);
  const msg = str(e.message);
  if (msg) out.message = scrubMessage(msg);
  if (depth < 2 && e.cause !== undefined) out.cause = describeErrorForLog(e.cause, depth + 1);
  return out;
}
