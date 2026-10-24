"use server";

import { redirect } from "next/navigation";
import { isValidTokenShape, postUnsubscribe } from "@/lib/portal-review-tokens";

/**
 * Button target of /r/unsubscribe. The page itself only renders on GET;
 * the opt-out happens here, on an explicit POST, so mail scanners that open
 * every link do not unsubscribe patients (B-22).
 */
export async function confirmUnsubscribe(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = isValidTokenShape(token)
    ? await postUnsubscribe(token)
    : { ok: false, clinicName: null };
  redirect(
    `/r/unsubscribe?token=${encodeURIComponent(token)}&status=${result.ok ? "done" : "failed"}`
  );
}
