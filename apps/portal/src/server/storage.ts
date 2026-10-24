import "server-only";
import { env, hasR2 } from "@/lib/env";

/**
 * Storage adapter — returns browser-accessible URLs for object keys.
 *
 * Local driver: files live under `storage/<key>` next to the portal app and
 * are served by the `/api/files/[...path]` passthrough route. Useful in
 * dev and for the seed fixtures.
 *
 * R2 driver: signs a short-lived GET URL via the S3 SDK. R2_PUBLIC_BASE is
 * honoured ONLY for keys under PUBLIC_KEY_PREFIXES (avatars): documents,
 * client uploads, checklist files, reports, CSV imports and backups are
 * always presigned, even when a public base is configured (L-11). Point the
 * public base at a bucket/domain that only serves `avatars/`.
 * The signed-URL path is lazy-imported so local setups don't pull @aws-sdk.
 *
 * R2 bucket CORS (required, not in code): browsers PUT straight to the
 * presigned URL from the portal origin, which triggers a preflight. Without
 * this rule on the bucket every upload fails with "Verbindung abgebrochen":
 *   [{ "AllowedOrigins": ["https://portal.eins.ag", "https://admin.eins.ag"],
 *      "AllowedMethods": ["PUT", "GET", "HEAD"],
 *      "AllowedHeaders": ["content-type"],
 *      "ExposeHeaders": ["ETag"],
 *      "MaxAgeSeconds": 3600 }]
 * Cloudflare dashboard: R2 > bucket > Settings > CORS policy. Verify with one
 * real upload on portal.eins.ag before the first Praxis starts.
 */

/**
 * Key prefixes that may be served from R2_PUBLIC_BASE without a signature.
 * Avatars only: they are rendered in tables on every page, carry no patient
 * data, and their keys are per user. Everything else is presigned (L-11).
 */
export const PUBLIC_KEY_PREFIXES = ["avatars/"] as const;

export function isPublicKey(key: string): boolean {
  return !key.includes("..") && PUBLIC_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * A prefix for `removePrefix` must name a folder ("<clinicId>/",
 * "pvs-csv-uploads/<clinicId>/"): non-empty segments, trailing slash, no
 * "..". Guards against an empty or root prefix wiping the whole bucket.
 */
export function assertDeletablePrefix(prefix: string): void {
  const ok =
    prefix.endsWith("/") &&
    !prefix.startsWith("/") &&
    !prefix.includes("..") &&
    prefix.split("/").slice(0, -1).every((seg) => seg.length > 0) &&
    prefix.length >= 8;
  if (!ok) throw new Error(`storage: unsafe prefix for removePrefix: ${JSON.stringify(prefix)}`);
}

export interface Storage {
  /** Public (or presigned) URL for reading a stored object. */
  urlFor(key: string, options?: { expiresInSeconds?: number }): Promise<string>;
  /**
   * Synchronous, NON-presigned public URL for `key`. Used in hot-path
   * server-component rendering (avatars in tables, dropdowns, timelines)
   * where awaiting a signed-URL per row would be a per-render network call.
   * Returns null when the active driver can't produce a public URL without
   * signing (e.g. R2 without `R2_PUBLIC_BASE`). Callers fall back to initials.
   */
  publicUrlFor(key: string): string | null;
  /** Upload a buffer. Returns the storage key. */
  put(
    key: string,
    body: Buffer | Uint8Array,
    options?: { contentType?: string }
  ): Promise<void>;
  /**
   * Presigned browser-PUT URL for `key`, or null when the active driver has
   * no presigning (local dev). Client uploads go DIRECTLY to object storage
   * with this URL — Vercel serverless caps request bodies at ~4.5 MB, so
   * routing file bytes through a server action or route handler is a dead
   * end in production. Local dev falls back to the /api/uploads route.
   */
  presignedPutUrl(
    key: string,
    options: { contentType?: string; expiresInSeconds?: number }
  ): Promise<string | null>;
  /**
   * Object metadata, or null if the object does not exist. Used by
   * finalize-upload actions to verify the client actually delivered the
   * bytes before a DB row is written.
   */
  head(key: string): Promise<{ size: number; contentType?: string } | null>;
  /** Delete an object. */
  remove(key: string): Promise<void>;
  /**
   * Delete every object whose key starts with `prefix` (a folder such as
   * "<clinicId>/"), including objects that never got a DB row (aborted
   * presigned uploads). Returns how many objects were deleted and how many
   * could not be. Used by the DSGVO erasure (L-12 / J-5).
   */
  removePrefix(prefix: string): Promise<{ removed: number; failed: number }>;
  /**
   * Read the full object body. Used by background workers that need to
   * process the file (e.g. the PVS CSV-ingest worker). For very large
   * files prefer streaming, but EINS clinic CSVs are bounded (< 50 MB).
   */
  read(key: string): Promise<Buffer>;
}

class LocalStorage implements Storage {
  async urlFor(key: string): Promise<string> {
    return this.publicUrlFor(key);
  }

  publicUrlFor(key: string): string {
    // Served by /api/files/[...path] passthrough — relative path so it works
    // in any environment.
    return `/api/files/${encodeURI(key)}`;
  }

  async put(
    key: string,
    body: Buffer | Uint8Array
  ): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname, join, resolve } = await import("node:path");
    const root = resolve(process.cwd(), "storage");
    const fullPath = join(root, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body);
  }

  async presignedPutUrl(): Promise<string | null> {
    // No presigning locally — the client helper falls back to POSTing the
    // bytes to /api/uploads, which streams them into storage/<key>.
    return null;
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    const { stat } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const root = resolve(process.cwd(), "storage");
    try {
      const s = await stat(join(root, key));
      if (!s.isFile()) return null;
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const root = resolve(process.cwd(), "storage");
    try {
      await unlink(join(root, key));
    } catch {
      // ignore — idempotent delete
    }
  }

  async removePrefix(prefix: string): Promise<{ removed: number; failed: number }> {
    assertDeletablePrefix(prefix);
    const { readdir, rm } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const root = resolve(process.cwd(), "storage");
    const dir = join(root, prefix);
    let removed = 0;
    try {
      const entries = await readdir(dir, { recursive: true, withFileTypes: true });
      removed = entries.filter((e) => e.isFile()).length;
    } catch {
      return { removed: 0, failed: 0 }; // folder does not exist
    }
    await rm(dir, { recursive: true, force: true });
    return { removed, failed: 0 };
  }

  async read(key: string): Promise<Buffer> {
    const { readFile } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const root = resolve(process.cwd(), "storage");
    return await readFile(join(root, key));
  }
}

class R2Storage implements Storage {
  publicUrlFor(key: string): string | null {
    if (env.R2_PUBLIC_BASE && isPublicKey(key)) {
      return `${env.R2_PUBLIC_BASE.replace(/\/$/, "")}/${key}`;
    }
    return null;
  }

  async urlFor(
    key: string,
    options?: { expiresInSeconds?: number }
  ): Promise<string> {
    const pub = this.publicUrlFor(key);
    if (pub) return pub;
    // Lazy-import the S3 SDK on-demand so local-first setups
    // (STORAGE_DRIVER=local) never pull it into the hot path. webpackIgnore
    // keeps webpack from bundling it; it's listed in serverExternalPackages
    // (next.config.ts) so Next file-tracing still ships it to Vercel.
    const { S3Client, GetObjectCommand } = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const { getSignedUrl } = await import(
      /* webpackIgnore: true */ "@aws-sdk/s3-request-presigner"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const cmd = new GetObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
    });
    return getSignedUrl(client, cmd, {
      expiresIn: options?.expiresInSeconds ?? 3600,
    });
  }

  async put(
    key: string,
    body: Buffer | Uint8Array,
    options?: { contentType?: string }
  ): Promise<void> {
    const { S3Client, PutObjectCommand } = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET!,
        Key: key,
        Body: body,
        ContentType: options?.contentType,
      })
    );
  }

  async presignedPutUrl(
    key: string,
    options: { contentType?: string; expiresInSeconds?: number }
  ): Promise<string | null> {
    const { S3Client, PutObjectCommand } = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const { getSignedUrl } = await import(
      /* webpackIgnore: true */ "@aws-sdk/s3-request-presigner"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const cmd = new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      ContentType: options.contentType,
    });
    return getSignedUrl(client, cmd, {
      expiresIn: options.expiresInSeconds ?? 3600,
    });
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    const { S3Client, HeadObjectCommand } = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: env.R2_BUCKET!, Key: key })
      );
      return {
        size: Number(out.ContentLength ?? 0),
        contentType: out.ContentType ?? undefined,
      };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    const { S3Client, DeleteObjectCommand } = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.R2_BUCKET!,
        Key: key,
      })
    );
  }

  async removePrefix(prefix: string): Promise<{ removed: number; failed: number }> {
    assertDeletablePrefix(prefix);
    const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    let removed = 0;
    let failed = 0;
    let token: string | undefined;
    // List one page (max 1000 keys), delete it in one DeleteObjects call,
    // repeat. Deleting while listing is safe: the continuation token points
    // past the page we just handled.
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: env.R2_BUCKET!,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: token,
        })
      );
      const keys = (page.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
      if (keys.length > 0) {
        const out = await client.send(
          new DeleteObjectsCommand({
            Bucket: env.R2_BUCKET!,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          })
        );
        const errors = out.Errors?.length ?? 0;
        failed += errors;
        removed += keys.length - errors;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return { removed, failed };
  }

  async read(key: string): Promise<Buffer> {
    const { S3Client, GetObjectCommand } = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const out = await client.send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key })
    );
    const body = out.Body;
    if (!body) throw new Error(`r2: no body for key ${key}`);
    // Collect the AsyncIterable<Uint8Array> stream into one buffer.
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

let singleton: Storage | null = null;

export function getStorage(): Storage {
  if (!singleton) {
    singleton = hasR2() ? new R2Storage() : new LocalStorage();
  }
  return singleton;
}

/**
 * Delete several objects, best effort. Every key is attempted even when one
 * fails; returns the keys that could not be deleted so the caller can log or
 * audit them (e.g. DSGVO deletion). Missing objects count as deleted.
 */
export async function deleteObjects(keys: string[]): Promise<string[]> {
  const storage = getStorage();
  const unique = [...new Set(keys.filter((k) => k.length > 0))];
  const results = await Promise.allSettled(unique.map((k) => storage.remove(k)));
  return unique.filter((_, i) => results[i]!.status === "rejected");
}
