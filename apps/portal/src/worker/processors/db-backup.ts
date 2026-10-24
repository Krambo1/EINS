import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { bossConnectionString, env, hasR2 } from "@/lib/env";
import { notifyOps } from "@/server/ops-alerts";

/**
 * Nightly Postgres backup.
 *
 * In production: `pg_dump` streamed directly to R2 via the S3 SDK multipart
 * upload. In dev or when R2 isn't configured, we just log and skip — local
 * data isn't worth backing up.
 *
 * Relies on `pg_dump` being present in PATH. Fails loudly if it isn't.
 *
 * Where the dump goes (L-3):
 *   - R2_BACKUP_BUCKET set: a separate, private bucket. Optional own key pair
 *     R2_BACKUP_ACCESS_KEY_ID / R2_BACKUP_SECRET_ACCESS_KEY (create it in
 *     Cloudflare with "Object Read & Write" on that bucket only); without it
 *     the app key pair is used. Never attach a public domain or r2.dev URL
 *     to that bucket.
 *   - Not set: the app bucket, as before. The key is still unguessable and
 *     the app never serves it (storage.ts presigns everything except
 *     `avatars/`, so R2_PUBLIC_BASE cannot expose `backups/`).
 *   - Key: `backups/portal-YYYY-MM-DD-<32 hex>.sql.gz`. The random part
 *     means nobody can derive a URL from the date.
 *
 * Retention is NOT in code. Set it on the bucket that receives the dumps
 * (Cloudflare dashboard > R2 > <bucket> > Settings > Object lifecycle rules):
 *   rule "backups-30d", prefix `backups/`, "Delete objects after 30 days".
 * A DSGVO erasure (server/dsgvo.ts) does not reach existing dumps; it is
 * complete only once the last dump taken before it has expired, i.e. after
 * at most 30 days.
 */

/**
 * libpq connection env vars parsed from a Postgres DSN, so the credentials
 * never land on the `pg_dump` argv — a DSN on the command line exposes the
 * password in `ps` / `/proc/<pid>/cmdline` to any co-resident process
 * (pentest H10).
 */
function pgEnvFromDsn(dsn: string): Record<string, string> {
  const u = new URL(dsn);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, "") || "postgres",
    PGSSLMODE: u.searchParams.get("sslmode") ?? "require",
  };
}

export async function processDbBackup(): Promise<void> {
  if (!hasR2()) {
    console.log("[db-backup] R2 not configured — skipping backup");
    return;
  }

  const key = backupObjectKey();
  const target = backupTarget();

  let chunks: Buffer[];
  try {
    chunks = await runDump();
  } catch (err) {
    // E-03: fail the job cleanly (no crash, no truncated upload) and tell ops.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[db-backup] failed:", message);
    await notifyOps({
      clinicId: null,
      kind: "db_backup_failed",
      severity: "high",
      title: "Nächtliches DB-Backup fehlgeschlagen",
      body: message.slice(0, 1000),
    });
    throw err;
  }

  const [{ S3Client, PutObjectCommand }] = await Promise.all([
    import(/* webpackIgnore: true */ "@aws-sdk/client-s3"),
  ]);
  const s3 = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: Buffer.concat(chunks),
      ContentType: "application/gzip",
      // Explicit server-side encryption at rest (pentest H10). NOTE: this is a
      // full-DB PHI dump — set a retention lifecycle on the `backups/` prefix
      // in the R2 console, and consider client-side encryption since SSE does
      // not protect against leaked R2 credentials.
      ServerSideEncryption: "AES256",
    })
  );
  // Bucket kind only; the key is unguessable on purpose and stays out of logs.
  console.log(`[db-backup] wrote backup to ${target.separate ? "backup" : "app"} bucket`);
}

/** `backups/portal-YYYY-MM-DD-<32 hex>.sql.gz` (date for sorting, random for secrecy). */
export function backupObjectKey(now: Date = new Date()): string {
  return `backups/portal-${now.toISOString().slice(0, 10)}-${randomBytes(16).toString("hex")}.sql.gz`;
}

/** Separate backup bucket when configured, else the app bucket (L-3). */
export function backupTarget(
  source: {
    R2_BACKUP_BUCKET?: string;
    R2_BACKUP_ACCESS_KEY_ID?: string;
    R2_BACKUP_SECRET_ACCESS_KEY?: string;
  } = env
): {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  separate: boolean;
} {
  const bucket = source.R2_BACKUP_BUCKET?.trim();
  const ownKey = source.R2_BACKUP_ACCESS_KEY_ID?.trim();
  const ownSecret = source.R2_BACKUP_SECRET_ACCESS_KEY?.trim();
  if (bucket) {
    return {
      bucket,
      accessKeyId: ownKey && ownSecret ? ownKey : env.R2_ACCESS_KEY_ID!,
      secretAccessKey: ownKey && ownSecret ? ownSecret : env.R2_SECRET_ACCESS_KEY!,
      separate: true,
    };
  }
  return {
    bucket: env.R2_BUCKET!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    separate: false,
  };
}

/**
 * Run `pg_dump | gzip -9` and collect the compressed bytes (E-03).
 *
 * - `error` listeners on both children: a missing binary (ENOENT) used to be
 *   an unhandled 'error' event that killed the whole worker process.
 * - pg_dump's exit code is checked, not only gzip's: an aborted dump must
 *   never be uploaded as a "successful" (truncated) backup.
 * - Direct connection (`DATABASE_URL_DIRECT`), not the transaction pooler.
 * The gzipped dump is buffered once (tens of MB expected).
 */
function runDump(): Promise<Buffer[]> {
  return new Promise<Buffer[]>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      dump.kill("SIGKILL");
      gzip.kill("SIGKILL");
      reject(err);
    };

    // Credentials via libpq env, not argv (pentest H10). Only non-secret
    // flags stay on the command line.
    const dump = spawn("pg_dump", ["--no-owner", "--no-privileges"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...pgEnvFromDsn(bossConnectionString()) },
    });
    const gzip = spawn("gzip", ["-9"], { stdio: ["pipe", "pipe", "pipe"] });

    dump.on("error", (e) => fail(new Error(`pg_dump not runnable: ${e.message}`)));
    gzip.on("error", (e) => fail(new Error(`gzip not runnable: ${e.message}`)));
    gzip.stdin.on("error", () => undefined); // EPIPE when gzip died first
    dump.stdout.pipe(gzip.stdin);

    let dumpErr = "";
    dump.stderr.on("data", (buf: Buffer) => {
      dumpErr = (dumpErr + buf.toString()).slice(-2000);
      console.error("[pg_dump]", buf.toString());
    });
    gzip.stderr.on("data", (buf: Buffer) => console.error("[gzip]", buf.toString()));

    const chunks: Buffer[] = [];
    gzip.stdout.on("data", (c: Buffer) => chunks.push(c));

    // Settle only once BOTH processes have closed (their order is not fixed).
    let dumpCode: number | null = null;
    let gzipCode: number | null = null;
    const maybeDone = () => {
      if (settled || dumpCode === null || gzipCode === null) return;
      if (dumpCode !== 0) {
        return fail(new Error(`pg_dump exit ${dumpCode}: ${dumpErr.trim().slice(-500)}`));
      }
      if (gzipCode !== 0) return fail(new Error(`gzip exit ${gzipCode}`));
      settled = true;
      resolve(chunks);
    };
    dump.on("close", (code) => {
      dumpCode = code ?? 1;
      maybeDone();
    });
    gzip.on("close", (code) => {
      gzipCode = code ?? 1;
      maybeDone();
    });
  });
}
