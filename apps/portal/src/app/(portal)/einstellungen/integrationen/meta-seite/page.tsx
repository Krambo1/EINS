import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { loadMetaPagePicker } from "@/server/meta-pages";
import { Brand } from "@/app/_components/Brand";
import { SettingsHead, WERBEKONTEN } from "../../_components/SettingsHead";
import { CardBody, CardFoot, PRIMARY_BUTTON, SECONDARY_BUTTON, SettingsCard } from "../../_components/settings-ui";
import { COLUMNS, STACK } from "../../_lib/sizes";
import { MetaPagePicker } from "./_picker";

/**
 * /einstellungen/integrationen/meta-seite (E6)
 *
 * The owner picks which Facebook page belongs to the Praxis when the
 * Facebook account admins several. Page names are read server side with
 * the user token the OAuth callback stored encrypted; the client form only
 * ever sees page ids and names, never a token. Same permission as starting
 * the Meta connection.
 */

export const metadata = { title: "Facebook-Seite wählen" };

const RECONNECT_HREF = "/api/integrations/meta/start";

export default async function MetaSeitePage() {
  const session = await requirePermissionOrRedirect("settings.integrations");
  const data = await loadMetaPagePicker(session.clinicId);

  return (
    <div className={STACK}>
      <SettingsHead title="Facebook-Seite wählen" trail={[WERBEKONTEN]} />
      <div className={COLUMNS}>
        <SettingsCard id="seite" title={<Brand brand="meta">Meta · Facebook &amp; Instagram</Brand>}>
          {data.status === "not_connected" && (
            <Said
              sentence="Meta ist für Ihre Praxis nicht verbunden. Verbinden Sie zuerst Ihr Meta-Konto, danach wählen Sie hier die Seite."
              foot={
                <Button asChild className={PRIMARY_BUTTON}>
                  <Link href="/einstellungen#werbekonten">Zu den Werbekonten</Link>
                </Button>
              }
            />
          )}

          {data.status === "token_expired" && (
            <Said
              sentence="Die Verbindung zu Facebook ist abgelaufen. Bitte verbinden Sie Meta erneut, danach können Sie die Seite wählen."
              foot={
                <Button asChild className={PRIMARY_BUTTON}>
                  {/* Plain <a>: a prefetched Link would start the OAuth flow. */}
                  <a href={RECONNECT_HREF}>Meta erneut verbinden</a>
                </Button>
              }
            />
          )}

          {data.status === "fetch_failed" && (
            <Said
              sentence="Die Liste Ihrer Seiten konnte gerade nicht von Facebook geladen werden. Bitte versuchen Sie es in ein paar Minuten erneut."
              foot={
                <>
                  <Button asChild variant="outline" className={SECONDARY_BUTTON}>
                    <a href={RECONNECT_HREF}>
                      <span className="sm:hidden">Neu verbinden</span>
                      <span className="hidden sm:inline">Meta erneut verbinden</span>
                    </a>
                  </Button>
                  <Button asChild className={PRIMARY_BUTTON}>
                    <a href="/einstellungen/integrationen/meta-seite">Erneut laden</a>
                  </Button>
                </>
              }
            />
          )}

          {data.status === "ok" && data.pages.length === 0 && (
            <Said
              sentence="Ihr Facebook-Konto verwaltet keine Seite. Bitte verbinden Sie Meta mit dem Facebook-Konto, das die Seite Ihrer Praxis verwaltet."
              foot={
                <Button asChild className={PRIMARY_BUTTON}>
                  <a href={RECONNECT_HREF}>Meta erneut verbinden</a>
                </Button>
              }
            />
          )}

          {data.status === "ok" && data.pages.length > 0 && (
            <MetaPagePicker pages={data.pages} hasCurrent={data.currentPageId !== null}>
              {data.currentPageId && !data.pages.some((p) => p.current) && (
                <p className="text-[15px] leading-6 text-fg-primary">
                  Die bisher verbundene Seite (Seiten-ID <span className="break-all">{data.currentPageId}</span>) ist in
                  diesem Facebook-Konto nicht mehr zu finden.
                </p>
              )}
              {data.pages.length === 1 && (
                <p className="text-[15px] leading-6 text-fg-primary">Ihr Facebook-Konto verwaltet nur diese eine Seite.</p>
              )}
            </MetaPagePicker>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}

/** A state with nothing to pick: what stands, and the way on in the foot. */
function Said({ sentence, foot }: { sentence: string; foot: ReactNode }) {
  return (
    <>
      <CardBody>
        <p className="text-[15px] leading-6 text-fg-primary">{sentence}</p>
      </CardBody>
      <CardFoot>{foot}</CardFoot>
    </>
  );
}
