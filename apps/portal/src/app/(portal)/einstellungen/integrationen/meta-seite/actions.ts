"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { writeAudit } from "@/server/audit";
import { flashError, flashSuccess } from "@/lib/flash";
import { describeErrorForLog } from "@/lib/error-log";
import {
  META_PAGE_ERRORS,
  META_PAGE_ID_PATTERN,
  chooseAndStoreMetaPage,
  metaPageChoiceErrorText,
  metaPageErrorText,
} from "@/server/meta-pages";

/**
 * E6: bind the Facebook page the owner picked on
 * /einstellungen/integrationen/meta-seite.
 *
 * Trust boundary: the form carries only `pageId`. The Praxis comes from the
 * session, the user token from platform_credentials (stored encrypted by the
 * OAuth callback), the page token from a fresh /me/accounts read. The id
 * must be in that fresh list; a page another Praxis is bound to is refused,
 * never taken over (J-1 rules in server/meta-pages.ts). Same permission as
 * starting the Meta connection (`settings.integrations`, Inhaber only).
 * CSRF: Next server actions check the Origin header.
 */

export type MetaPagePickState = { error: string } | undefined;

const FORBIDDEN_TEXT = "Dafür fehlt Ihrer Rolle die Berechtigung.";
const NO_CHOICE_TEXT = "Bitte wählen Sie eine Seite aus.";

export async function chooseMetaPageAction(
  _prev: MetaPagePickState,
  formData: FormData
): Promise<MetaPagePickState> {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return { error: FORBIDDEN_TEXT };
  }
  const raw = formData.get("pageId");
  if (typeof raw !== "string" || !META_PAGE_ID_PATTERN.test(raw)) {
    return { error: NO_CHOICE_TEXT };
  }

  let result: Awaited<ReturnType<typeof chooseAndStoreMetaPage>>;
  try {
    result = await chooseAndStoreMetaPage(session.clinicId, raw);
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    // A refused page is security-relevant (J-1): keep it in the audit log.
    if (code === META_PAGE_ERRORS.boundElsewhere) {
      await writeAudit({
        clinicId: session.clinicId,
        actorId: session.userId,
        actorEmail: session.email,
        action: "meta_page_select_refused",
        entityKind: "platform_credential",
        diff: { platform: "meta", pageId: raw, reason: code },
      });
    } else {
      console.warn(
        "[meta-seite] page choice failed:",
        JSON.stringify(describeErrorForLog(err))
      );
    }
    return { error: metaPageChoiceErrorText(err) };
  }

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "meta_page_select",
    entityKind: "platform_credential",
    diff: {
      platform: "meta",
      pageId: result.page.id,
      pageName: result.page.name,
      previousPageId: result.previousPageId,
      leadgenSubscribed: result.leadgenSubscribed,
    },
  });

  revalidatePath("/einstellungen");
  revalidatePath("/werbebudget");
  revalidatePath("/einstellungen/integrationen/meta-seite");
  if (result.leadgenSubscribed) {
    await flashSuccess("Facebook-Seite verbunden", result.page.name || undefined);
  } else {
    // E6b: the page is bound, but Meta refused the leadgen subscription.
    await flashError(
      "Facebook-Seite verbunden, Anfragen noch nicht aktiv",
      metaPageErrorText(new Error(META_PAGE_ERRORS.leadgenSubscribeFailed))
    );
  }
  redirect("/einstellungen#werbekonten");
}
