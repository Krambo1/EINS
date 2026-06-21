import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft, CheckCircle2, Pencil } from "lucide-react";
import { Card, CardContent, Badge, Button } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import {
  DISCOVERY_BLOCKS,
  DISCOVERY_INTRO,
  type DiscoveryAnswers,
} from "./content";
import { FragebogenForm } from "./FragebogenForm";
import { reopenDiscoveryAction } from "./actions";

export const metadata = { title: "Fragebogen zum Start" };

/**
 * Discovery-Fragebogen, Teil 1 (Vorab-Formular). Inhaber-only, like the rest
 * of /onboarding. Draft until submitted; submitted answers render read-only.
 */
export default async function DiscoveryFragebogenPage() {
  const session = await requirePermissionOrRedirect("onboarding.complete");

  const [row] = await db
    .select()
    .from(schema.discoveryFragebogen)
    .where(eq(schema.discoveryFragebogen.clinicId, session.clinicId))
    .limit(1);

  const answers = (row?.answers ?? {}) as DiscoveryAnswers;
  const submitted = row?.status === "eingereicht";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href="/onboarding"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zu den ersten Schritten
        </Link>
        <h1 className="mt-3 text-3xl font-semibold md:text-4xl">
          Fragebogen zum Start
        </h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          {DISCOVERY_INTRO}
        </p>
      </header>

      {submitted ? (
        <>
          <Card className="p-5 md:p-6">
            <CardContent className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-tone-good" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    Vielen Dank, Ihre Antworten sind bei uns.
                  </span>
                  <Badge tone="good">Eingereicht</Badge>
                </div>
                <p className="mt-1 text-base text-fg-primary">
                  Wir bauen darauf Ihre Kampagnen, Ihre Zielseite und das
                  Video-Konzept auf. Den Rest besprechen wir im
                  Onboarding-Gespräch. Hat sich etwas geändert? Sie können Ihre
                  Antworten jederzeit anpassen, Ihr EINS-Team wird automatisch
                  informiert.
                </p>
                {row?.submittedAt && (
                  <p className="mt-1 text-sm text-fg-secondary">
                    Eingereicht am{" "}
                    {row.submittedAt.toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                    {row.resubmittedAt && (
                      <>
                        {", zuletzt angepasst am "}
                        {row.resubmittedAt.toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </>
                    )}
                    .
                  </p>
                )}
                <form action={reopenDiscoveryAction} className="mt-4">
                  <Button type="submit" variant="outline" size="sm">
                    <Pencil className="h-4 w-4" />
                    Antworten anpassen
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>

          {/* Read-only recap of what was answered. */}
          <div className="space-y-6">
            {DISCOVERY_BLOCKS.map((block) => (
              <Card key={block.key} className="p-5 md:p-6">
                <CardContent className="space-y-4">
                  <h2 className="text-lg font-semibold">{block.title}</h2>
                  <dl className="space-y-4">
                    {block.questions.map((q) => {
                      const value = answers[q.id];
                      const text = Array.isArray(value)
                        ? value.join(", ")
                        : value;
                      return (
                        <div key={q.id}>
                          <dt className="text-sm font-medium text-fg-secondary">
                            {q.label}
                          </dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-base text-fg-primary">
                            {text && text.length > 0 ? (
                              text
                            ) : (
                              <span className="text-fg-tertiary">
                                Keine Angabe
                              </span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <FragebogenForm initialAnswers={answers} hasDraft={Boolean(row)} />
      )}
    </div>
  );
}
