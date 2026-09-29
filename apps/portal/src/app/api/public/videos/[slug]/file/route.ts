import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { hasR2 } from "@/lib/env";
import { localVideoFileKey } from "@/server/outreach-videos";

/**
 * GET /api/public/videos/[slug]/file[?part=poster]   · local dev only
 *
 * With STORAGE_DRIVER=local there is no R2 URL to hand the watch page, and
 * /api/files needs a clinic session the viewer does not have. This streams
 * the stored file for a known slug, with Range support so the player can
 * seek. Answers 404 whenever R2 is configured, i.e. in every real deployment.
 */

const STORAGE_ROOT = resolve(process.cwd(), "storage");

/**
 * Node file stream → web stream that stops reading when the browser cancels
 * (the video element aborts range requests constantly while seeking) and
 * pauses when the consumer is slow. `Readable.toWeb` crashes the dev server
 * with "Controller is already closed" on the first cancelled request.
 */
function fileStream(path: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const node = createReadStream(path, range);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk) => {
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
        } catch {
          node.destroy();
          return;
        }
        if ((controller.desiredSize ?? 1) <= 0) node.pause();
      });
      node.on("end", () => {
        try {
          controller.close();
        } catch {
          // already cancelled
        }
      });
      node.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          // already cancelled
        }
      });
    },
    pull() {
      node.resume();
    },
    cancel() {
      node.destroy();
    },
  });
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  if (hasR2()) return new NextResponse("Not Found", { status: 404 });
  const { slug } = await ctx.params;
  const part = request.nextUrl.searchParams.get("part") === "poster" ? "poster" : "video";
  const file = await localVideoFileKey(slug, part);
  if (!file) return new NextResponse("Not Found", { status: 404 });

  const full = resolve(join(STORAGE_ROOT, file.key));
  if (!full.startsWith(STORAGE_ROOT + sep)) return new NextResponse("Forbidden", { status: 403 });

  let size: number;
  try {
    size = (await stat(full)).size;
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start: number;
    let end: number;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      // "bytes=-N": the last N bytes.
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new NextResponse(fileStream(full, { start, end }), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(fileStream(full), {
    status: 200,
    headers: { ...headers, "Content-Length": String(size) },
  });
}
