import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { loadMetaPagePicker } from "@/server/meta-pages";
import { Brand } from "@/app/_components/Brand";
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
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen#werbekonten"
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Einstellungen
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Facebook-Seite wählen</h1>
        <p className="mt-1 text-base text-fg-primary">
          Wählen Sie die Facebook-Seite Ihrer Praxis. Anfragen aus den
          Meta-Formularen dieser Seite kommen danach direkt in Ihr Portal.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brand brand="meta">Meta · Facebook &amp; Instagram</Brand>
          </CardTitle>
          {data.status === "ok" && data.pages.length > 1 && (
            <CardDescription>
              Ihr Facebook-Konto verwaltet mehrere Seiten. Eine Seite kann
              immer nur mit einer Praxis verbunden sein.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {data.status === "not_connected" && (
            <>
              <p className="text-base text-fg-primary">
                Meta ist für Ihre Praxis nicht verbunden. Verbinden Sie zuerst
                Ihr Meta-Konto, danach wählen Sie hier die Seite.
              </p>
              <Button asChild>
                <Link href="/einstellungen#werbekonten">Zu den Werbekonten</Link>
              </Button>
            </>
          )}

          {data.status === "token_expired" && (
            <>
              <p className="text-base text-fg-primary">
                Die Verbindung zu Facebook ist abgelaufen. Bitte verbinden Sie
                Meta erneut, danach können Sie die Seite wählen.
              </p>
              <Button asChild>
                {/* Plain <a>: a prefetched Link would start the OAuth flow. */}
                <a href={RECONNECT_HREF}>Meta erneut verbinden</a>
              </Button>
            </>
          )}

          {data.status === "fetch_failed" && (
            <>
              <p className="text-base text-fg-primary">
                Die Liste Ihrer Seiten konnte gerade nicht von Facebook geladen
                werden. Bitte versuchen Sie es in ein paar Minuten erneut.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a href="/einstellungen/integrationen/meta-seite">
                    Erneut laden
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={RECONNECT_HREF}>Meta erneut verbinden</a>
                </Button>
              </div>
            </>
          )}

          {data.status === "ok" && data.pages.length === 0 && (
            <>
              <p className="text-base text-fg-primary">
                Ihr Facebook-Konto verwaltet keine Seite. Bitte verbinden Sie
                Meta mit dem Facebook-Konto, das die Seite Ihrer Praxis
                verwaltet.
              </p>
              <Button asChild>
                <a href={RECONNECT_HREF}>Meta erneut verbinden</a>
              </Button>
            </>
          )}

          {data.status === "ok" && data.pages.length > 0 && (
            <>
              {data.currentPageId &&
                !data.pages.some((p) => p.current) && (
                  <p className="text-sm text-fg-primary">
                    Die bisher verbundene Seite (Seiten-ID{" "}
                    <span className="break-all">{data.currentPageId}</span>) ist
                    in diesem Facebook-Konto nicht mehr zu finden.
                  </p>
                )}
              {data.pages.length === 1 && (
                <p className="text-sm text-fg-primary">
                  Ihr Facebook-Konto verwaltet nur diese eine Seite.
                </p>
              )}
              <MetaPagePicker
                pages={data.pages}
                hasCurrent={data.currentPageId !== null}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
