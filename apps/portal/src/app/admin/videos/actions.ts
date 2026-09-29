"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/admin-guards";
import {
  createOutreachVideo,
  createVideoUploadTarget,
  setOutreachVideoArchived,
  type CreatedVideo,
  type VideoResult,
  type VideoUploadTarget,
} from "@/server/outreach-videos";

/**
 * Admin upload flow for outreach videos. Same three steps as "Dateien an
 * EINS" (server/uploads.ts explains why the bytes never pass through here):
 * mint a presigned target, the browser PUTs to R2, then finalize verifies
 * the object and writes the row.
 */

export async function createVideoUploadTargetAction(input: {
  kind: "video" | "poster";
  filename: string;
  size: number;
  contentType: string | null;
}): Promise<VideoResult<VideoUploadTarget>> {
  await requireAdmin();
  return createVideoUploadTarget(input);
}

export async function createOutreachVideoAction(input: {
  videoKey: string;
  posterKey: string | null;
  praxisName: string;
  title: string;
  message: string;
  recipientEmail: string;
  notionPage: string;
  durationSeconds: number | null;
}): Promise<VideoResult<CreatedVideo>> {
  const admin = await requireAdmin();
  const result = await createOutreachVideo(input, admin.email);
  if (result.ok) revalidatePath("/admin/videos");
  return result;
}

export async function setVideoArchivedAction(id: string, archived: boolean): Promise<void> {
  await requireAdmin();
  await setOutreachVideoArchived(id, archived);
  revalidatePath("/admin/videos");
  revalidatePath(`/admin/videos/${id}`);
}
