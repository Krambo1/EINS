import { requireSession } from "@/auth/guards";
import {
  impersonationBlockedMessage,
  isImpersonating,
} from "@/auth/impersonation-guard";
import { ActionForm } from "@/app/(portal)/_components/ActionForm";
import { PendingSubmit } from "@/app/(portal)/_components/PendingSubmit";
import { SettingsHead } from "../_components/SettingsHead";
import { CardBody, CardFoot, SECONDARY_BUTTON, SettingsCard } from "../_components/settings-ui";
import { COLUMNS, STACK } from "../_lib/sizes";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { LOGOUT_ALL } from "./_copy";
import { logoutAllDevicesAction } from "./actions";

export const metadata = { title: "Sicherheit" };
export const dynamic = "force-dynamic";

const SENTENCE = "text-[15px] leading-6 text-fg-primary";

/**
 * Password and signing out everywhere, as two cards in the Einstellungen
 * column (same width, the rail's place left empty). What both do is
 * unchanged, and both stay closed in an admin's view as the Praxis person
 * (`isImpersonating`; the actions check it again on the server).
 */
export default async function SicherheitPage() {
  const session = await requireSession();
  const impersonating = isImpersonating(session);

  return (
    <div className={STACK}>
      <SettingsHead title="Sicherheit" />

      <div className={COLUMNS}>
        <div className={STACK}>
          <SettingsCard id="passwort" title="Passwort">
            {impersonating ? (
              <CardBody>
                <p className={SENTENCE}>{impersonationBlockedMessage("password")}</p>
              </CardBody>
            ) : (
              <ChangePasswordForm />
            )}
          </SettingsCard>

          <SettingsCard id="abmelden" title="Auf allen Geräten abmelden">
            <CardBody className="space-y-3">
              <p className={SENTENCE}>{LOGOUT_ALL}</p>
              {impersonating && <p className={SENTENCE}>{impersonationBlockedMessage("logout_all_devices")}</p>}
            </CardBody>
            {!impersonating && (
              <ActionForm action={logoutAllDevicesAction}>
                <CardFoot>
                  <PendingSubmit variant="outline" className={SECONDARY_BUTTON}>
                    Überall abmelden
                  </PendingSubmit>
                </CardFoot>
              </ActionForm>
            )}
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
