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
  /** Upload a buffer. Returns the storage key. */
  put(
    key: string,
    body: Buffer | Uint8Array,
    options?: { contentType?: string }
  ): Promise<void>;
  /** Delete an object. */
  remove(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  async urlFor(key: string): Promise<string> {
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
}

class R2Storage implements Storage {
  async urlFor(
    key: string,
    options?: { expiresInSeconds?: number }
  ): Promise<string> {
    if (env.R2_PUBLIC_BASE) {
      return `${env.R2_PUBLIC_BASE.replace(/\/$/, "")}/${key}`;
    }
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
}

let singleton: Storage | null = null;

export function getStorage(): Storage {
  if (!singleton) {
    singleton = hasR2() ? new R2Storage() : new LocalStorage();
  }
  return singleton;
}
