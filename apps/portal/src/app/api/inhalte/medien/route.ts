import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { can } from "@/lib/roles";
import { listContentItemsForPractice } from "@/server/content";
import { listAssets } from "@/server/queries/assets";
import { getStorage } from "@/server/storage";
import { entryName, uniqueNames, type ZipFile } from "@/app/(portal)/inhalte/_lib/zip";

/**
 * GET /api/inhalte/medien
 *
 * The file of every post in "Alle Beiträge" (drafts left out, a file two
 * posts share once, named after the post) with fresh signed links, for
 * "Alle herunterladen": the browser reads them straight from storage and
 * packs the ZIP itself (inhalte/_lib/zip.ts). No file bytes pass through
 * this route.
 */
export const dynamic = "force-dynamic";

/** Long enough for a slow line to read several GB one file after the other. */
const LINK_SECONDS = 6 * 60 * 60;

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Nicht angemeldet." } },
      { status: 401 }
    );
  }
  if (!can(session.role, "assets.view")) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Zugriff verweigert." } },
      { status: 403 }
    );
  }

  const [items, assets] = await Promise.all([
    listContentItemsForPractice(session.clinicId, session.userId),
    listAssets(session.clinicId, session.userId),
  ]);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const picked = items.flatMap((i) => {
    if (!i.assetStorageKey || seen.has(i.assetStorageKey)) return [];
    seen.add(i.assetStorageKey);
    const a = i.assetId ? assetById.get(i.assetId) : undefined;
    return [
      {
        key: i.assetStorageKey,
        title: i.title,
        mime: a?.mimeType ?? null,
        size: a?.fileSizeBytes ?? null,
        modified: (a?.createdAt ?? i.createdAt).toISOString(),
      },
    ];
  });
  const storage = getStorage();
  const names = uniqueNames(picked.map((f) => entryName(f.title, f.key, f.mime)));

  const files: ZipFile[] = await Promise.all(
    picked.map(async (f, i) => ({
      name: names[i]!,
      url: await storage.urlFor(f.key, { expiresInSeconds: LINK_SECONDS }),
      downloadUrl: await storage.urlFor(f.key, {
        expiresInSeconds: LINK_SECONDS,
        downloadName: names[i]!,
      }),
      size: f.size,
      modified: f.modified,
    }))
  );

  return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
}
