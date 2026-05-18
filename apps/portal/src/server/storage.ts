import "server-only";
import { env, hasR2 } from "@/lib/env";

/**
 * Storage adapter — returns browser-accessible URLs for object keys.
 *
 * Local driver: files live under `storage/<key>` next to the portal app and
 * are served by the `/api/files/[...path]` passthrough route. Useful in
 * dev and for the seed fixtures.
 *
 * R2 driver: returns a public R2 URL if R2_PUBLIC_BASE is set (bucket is
 * public-read), otherwise signs a short-lived GET URL via the S3 SDK.
 * The signed-URL path is lazy-imported so local setups don't pull @aws-sdk.
 */

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
  /** Delete an object. */
  remove(key: string): Promise<void>;
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

  async read(key: string): Promise<Buffer> {
    const { readFile } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const root = resolve(process.cwd(), "storage");
    return await readFile(join(root, key));
  }
}

class R2Storage implements Storage {
  publicUrlFor(key: string): string | null {
    if (env.R2_PUBLIC_BASE) {
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
    // Lazy-import S3 SDK — not a hard dep for local-first setups. The
    // webpackIgnore directive keeps webpack from trying to bundle the
    // module (it'd fail the build when the optional dep isn't installed).
    const { S3Client, GetObjectCommand } = await import(
      // @ts-expect-error optional peer
      /* webpackIgnore: true */ "@aws-sdk/client-s3"
    );
    const { getSignedUrl } = await import(
      // @ts-expect-error optional peer
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
      // @ts-expect-error optional peer
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

  async remove(key: string): Promise<void> {
    const { S3Client, DeleteObjectCommand } = await import(
      // @ts-expect-error optional peer
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

  async read(key: string): Promise<Buffer> {
    const { S3Client, GetObjectCommand } = await import(
      // @ts-expect-error optional peer
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
