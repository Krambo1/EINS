"use server";

import { redirect } from "next/navigation";
import { isValidTokenShape, postClick } from "@/lib/portal-review-tokens";

/**
 * Button target of "Bewertung speichern" on /r/<token>?rating=N.
 *
 * Opening the page never books a star: mail link scanners open every star
 * link of the review mail, and a GET that records would turn a scan into a
 * rating (E-31). The rating is booked only here, on an explicit POST, or
 * together with the public CTA (go/route.ts POST) or the private feedback.
 */
export async function saveRating(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!isValidTokenShape(token)) redirect("/");
  const rating = parseRating(formData.get("rating"));
  if (rating !== null) {
    await postClick(token, { rating, target: "land" });
  }
  redirect(
    `/r/${encodeURIComponent(token)}${rating !== null ? `?rating=${rating}` : ""}`
  );
}

/**
 * Background save of the star tapped in the mail. The page calls it on the
 * patient's first real interaction (save-on-interaction.tsx), never on
 * load, so a link scanner opening the page books nothing (E-31). No
 * redirect: the patient stays where they are.
 */
export async function recordRating(token: string, rating: number): Promise<void> {
  if (!isValidTokenShape(token)) return;
  const n = parseRating(rating);
  if (n !== null) {
    await postClick(token, { rating: n, target: "land" });
  }
}

function parseRating(raw: FormDataEntryValue | number | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}
