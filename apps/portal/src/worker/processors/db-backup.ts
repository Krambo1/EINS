import { spawn } from "node:child_process";
import { env, hasR2 } from "@/lib/env";

/**
 * Nightly Postgres backup.
 *
 * In production: `pg_dump` streamed directly to R2 via the S3 SDK multipart
 * upload. In dev or when R2 isn't configured, we just log and skip — local
 * data isn't worth backing up.
 *
 * Relies on `pg_dump` being present in PATH. Fails loudly if it isn't.
 */
export async function processDbBackup(): Promise<void> {
  if (!hasR2()) {
    console.log("[db-backup] R2 not configured — skipping backup");
    return;
  }

  const key = `backups/portal-${new Date().toISOString().slice(0, 10)}.sql.gz`;

  const dump = spawn("pg_dump", [env.DATABASE_URL, "--no-owner", "--no-privileges"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const gzip = spawn("gzip", ["-9"], { stdio: ["pipe", "pipe", "pipe"] });

  dump.stdout.pipe(gzip.stdin);
  dump.stderr.on("data", (buf) => console.error("[pg_dump]", buf.toString()));
  gzip.stderr.on("data", (buf) => console.error("[gzip]", buf.toString()));

  const [{ S3Client, PutObjectCommand }] = await Promise.all([
    // @ts-expect-error optional peer, only installed when STORAGE_DRIVER=r2
    import(/* webpackIgnore: true */ "@aws-sdk/client-s3"),
  ]);
  const s3 = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });

  // Collect the gzipped dump into a Buffer — we're not expecting huge sizes
  // (tens of MB). If the DB grows much larger, switch to multipart upload.
  const chunks: Buffer[] = [];
  for await (const chunk of gzip.stdout) {
    chunks.push(chunk as Buffer);
  }
  const exitCode: number = await new Promise((resolve) => {
    dump.on("close", (dc) => gzip.stdin.end());
    gzip.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`gzip exit ${exitCode}`);

  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: Buffer.concat(chunks),
      ContentType: "application/gzip",
    })
  );
  console.log(`[db-backup] wrote ${key}`);
}
