"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, cn } from "@eins/ui";
import { CONTROL, DashCard, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { PendingSubmit } from "../../_components/PendingSubmit";
import { showActionFlash } from "../../_components/flash-event";
import { HeadCount, OnboardingHead, PageNote } from "../_components/OnboardingHead";
import { SectionRail, useActiveSection, type RailEntry } from "../_components/SectionRail";
import { StatusWord } from "../_components/StatusWord";
import { COLUMNS, ONBOARDING_PAGE, SUBMIT_BUTTONS, SUBMIT_ROW } from "../_lib/sizes";
import {
  DISCOVERY_BLOCKS,
  DISCOVERY_ESTIMATE_NOTE,
  isAnswered,
  type DiscoveryAnswers,
  type DiscoveryBlock,
} from "./content";
import { saveDiscoveryAction } from "./actions";
import { questionAnchorId, sectionAnchorId } from "./anchors";
import { QuestionField, SectionCard } from "./QuestionField";

interface FragebogenFormProps {
  initialAnswers: DiscoveryAnswers;
  /** `updatedAt` (ISO) of the loaded row, null when none; sent for the stale-tab check. */
  baseUpdatedAt: string | null;
  /** localStorage key for the on-device backup of unsaved answers (per clinic). */
  storageKey: string;
}

/** On-device backup of answers that are not yet saved on the server. */
interface LocalBackup {
  answers: DiscoveryAnswers;
  /** Server version the answers were typed against. */
  base: string | null;
  savedAt: number;
}

function readBackup(key: string): LocalBackup | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalBackup;
    if (!parsed || typeof parsed !== "object" || !parsed.answers || typeof parsed.answers !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeBackup(key: string, backup: LocalBackup | null) {
  try {
    if (backup) window.localStorage.setItem(key, JSON.stringify(backup));
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode / quota: the server draft is still the source of truth.
  }
}

const REQUIRED = DISCOVERY_BLOCKS.flatMap((b) => b.questions).filter((q) => q.required);

/** A section is done when its required questions are answered (without any: when anything is). */
export function sectionDone(block: DiscoveryBlock, answers: DiscoveryAnswers): boolean {
  const required = block.questions.filter((q) => q.required);
  return required.length > 0
    ? required.every((q) => isAnswered(answers[q.id]))
    : block.questions.some((q) => isAnswered(answers[q.id]));
}

/**
 * Teil-1 form. All answers live in one local state map keyed by question id;
 * "Zwischenspeichern" persists a draft, "Antworten einreichen" runs the
 * Pflichtfragen check server-side and freezes the row. Questions the server
 * reports missing get GOV.UK's red bar until they are answered. Saves and
 * errors go to the toast (DESIGN.md section 10); the page head counts the
 * Pflichtfragen, each section's head says Offen or Erledigt.
 */
export function FragebogenForm({ initialAnswers, baseUpdatedAt, storageKey }: FragebogenFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<DiscoveryAnswers>(initialAnswers);
  // Server version this form is based on; advances after each own save.
  const [base, setBase] = useState<string | null>(baseUpdatedAt);
  // Unsaved answers from an earlier visit whose server version moved on.
  const [staleBackup, setStaleBackup] = useState<LocalBackup | null>(null);
  // Questions the last submit reported open; each clears once touched.
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const dirty = useRef(false);

  // Restore unsaved answers from this device (session expired, network lost,
  // tab closed). Same server version: restore directly; otherwise ask.
  useEffect(() => {
    const backup = readBackup(storageKey);
    if (!backup) return;
    if (backup.base === baseUpdatedAt) {
      dirty.current = true;
      setAnswers(backup.answers);
      // After the toast's own effect has started listening.
      window.setTimeout(
        () =>
          showActionFlash({
            tone: "good",
            title: "Antworten wiederhergestellt",
            description: "Ihre noch nicht gespeicherten Antworten von diesem Gerät sind wieder da. Bitte speichern Sie sie.",
          }),
        0
      );
    } else {
      setStaleBackup(backup);
    }
    // Mount only: later prop changes come from our own saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror unsaved answers to localStorage (debounced).
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => {
      writeBackup(storageKey, { answers, base, savedAt: Date.now() });
    }, 500);
    return () => window.clearTimeout(t);
  }, [answers, base, storageKey]);

  const setAnswer = (id: string, value: string | string[]) => {
    dirty.current = true;
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setMissing((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // The form of the submit row: no fields in it, only the two buttons, so
  // PendingSubmit greys both out while the save runs.
  const persist = async (formData: FormData) => {
    const submit = formData.get("intent") === "submit";
    // Back up synchronously before the request, so a redirect to the login
    // page (expired session) never loses what was typed.
    writeBackup(storageKey, { answers, base, savedAt: Date.now() });
    try {
      const result = await saveDiscoveryAction({ answers, submit, baseUpdatedAt: base });
      if (result.kind === "saved" || result.kind === "submitted") {
        dirty.current = false;
        setBase(result.updatedAt);
        setMissing(new Set());
        writeBackup(storageKey, null);
        if (result.kind === "saved") {
          showActionFlash({
            tone: "good",
            title: "Entwurf gespeichert",
            description: "Sie können jederzeit weitermachen, auch von einem anderen Gerät.",
          });
        } else {
          showActionFlash({ tone: "good", title: "Antworten eingereicht", description: "Sie können sie weiterhin anpassen." });
          // Server state changed to read-only; re-render the page recap.
          router.refresh();
        }
        return;
      }
      if (result.kind !== "error") return;
      const ids = result.missingIds ?? [];
      if (ids.length > 0 && ids.every((id) => !isAnswered(answers[id]))) {
        setMissing(new Set(ids));
        showActionFlash({
          tone: "bad",
          title: ids.length === 1 ? "Noch 1 Pflichtfrage offen" : `Noch ${ids.length} Pflichtfragen offen`,
          description: "Die offenen Fragen sind rot markiert.",
        });
        document.getElementById(questionAnchorId(ids[0]!))?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      // An own amount that is no number (the id is answered, so not missing).
      if (ids.length > 0) setMissing(new Set(ids));
      showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: result.message });
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht gespeichert",
        description:
          "Zum Beispiel wegen der Internetverbindung. Ihre Eingaben sind noch da und auf diesem Gerät gesichert. Bitte versuchen Sie es gleich noch einmal.",
      });
    }
  };

  const adoptStaleBackup = () => {
    if (!staleBackup) return;
    dirty.current = true;
    setAnswers(staleBackup.answers);
    setStaleBackup(null);
  };
  const discardStaleBackup = () => {
    setStaleBackup(null);
    writeBackup(storageKey, null);
  };

  const open = REQUIRED.filter((q) => !isAnswered(answers[q.id]));
  const entries: RailEntry[] = DISCOVERY_BLOCKS.map((block) => ({
    id: sectionAnchorId(block.key),
    title: block.title,
    status: sectionDone(block, answers) ? "erledigt" : "offen",
  }));
  const active = useActiveSection(entries.map((e) => e.id));

  return (
    <div className={ONBOARDING_PAGE}>
      <OnboardingHead
        back
        title="Fragebogen"
        count={<HeadCount>{`${REQUIRED.length - open.length} von ${REQUIRED.length} Pflichtfragen`}</HeadCount>}
      />
      <PageNote>{DISCOVERY_ESTIMATE_NOTE}</PageNote>

      {staleBackup && (
        <ConflictRow savedAt={staleBackup.savedAt} onAdopt={adoptStaleBackup} onDiscard={discardStaleBackup} />
      )}

      <div className={COLUMNS}>
        <div className="space-y-4 md:space-y-6">
          {DISCOVERY_BLOCKS.map((block, i) => (
            <SectionCard
              key={block.key}
              block={block}
              status={<StatusWord status={entries[i]!.status} />}
            >
              {block.questions.map((q) => (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={answers[q.id]}
                  missing={missing.has(q.id)}
                  onChange={(v) => setAnswer(q.id, v)}
                />
              ))}
            </SectionCard>
          ))}

          <DashCard bodyClassName="pt-5 md:pt-6">
            <form action={persist} className={SUBMIT_ROW}>
              <SubmitStatus open={open.length} firstOpenId={open[0]?.id} />
              <SubmitButtons />
            </form>
          </DashCard>
        </div>
        <SectionRail entries={entries} active={active} />
      </div>
    </div>
  );
}

/**
 * Left of the submit row (GOV.UK's check answers, Stripe's "You won't be
 * able to submit until ..."): what is left, with a link to the first open
 * question, or that everything is answered; while saving, what happens.
 */
function SubmitStatus({ open, firstOpenId }: { open: number; firstOpenId?: string }) {
  const { pending, data } = useFormStatus();
  return (
    <div className="min-w-0">
      <p aria-live="polite" className="text-[15px] font-medium leading-6 text-fg-primary">
        {pending ? (
          data?.get("intent") === "submit" ? "Wird eingereicht …" : "Wird gespeichert …"
        ) : open > 0 ? (
          <>
            {open === 1 ? "Noch 1 Pflichtfrage offen" : `Noch ${open} Pflichtfragen offen`}
            {firstOpenId && (
              <>
                <span aria-hidden className="mx-2 font-normal text-fg-secondary">
                  ·
                </span>
                <a
                  href={`#${questionAnchorId(firstOpenId)}`}
                  className="rounded-[var(--r-small)] font-normal underline decoration-fg-tertiary underline-offset-4 hover:decoration-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Zur ersten
                </a>
              </>
            )}
          </>
        ) : (
          "Alle Pflichtfragen beantwortet"
        )}
      </p>
      <p className="mt-0.5 text-sm leading-5 text-fg-secondary">
        Nach dem Einreichen können Sie Ihre Antworten weiterhin anpassen.
      </p>
    </div>
  );
}

function SubmitButtons() {
  return (
    <div className={SUBMIT_BUTTONS}>
      <PendingSubmit name="intent" value="submit" className={cn(CONTROL, "px-4")}>
        Antworten einreichen
      </PendingSubmit>
      <PendingSubmit name="intent" value="draft" variant="outline" className={cn(RAISED_CONTROL, CONTROL, "px-4")}>
        Zwischenspeichern
      </PendingSubmit>
    </div>
  );
}

/**
 * Unsaved answers on this device against a newer server version (GitHub's
 * merge box row, Stripe's "Action required"): what happened in one line, the
 * when under it, the two choices at the right. Stays until decided.
 */
function ConflictRow({
  savedAt,
  onAdopt,
  onDiscard,
}: {
  savedAt: number;
  onAdopt: () => void;
  onDiscard: () => void;
}) {
  const when = new Date(savedAt).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <DashCard bodyClassName="pt-5 md:pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-6 text-fg-primary">
            Auf diesem Gerät liegen nicht gespeicherte Antworten
          </p>
          <p className="mt-0.5 text-sm leading-5 text-fg-secondary">
            Vom {when} Uhr. Der Fragebogen wurde seitdem an anderer Stelle gespeichert.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" onClick={onAdopt} className={cn(CONTROL, "flex-1 px-4 sm:flex-none")}>
            Übernehmen
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDiscard}
            className={cn(RAISED_CONTROL, CONTROL, "flex-1 px-4 sm:flex-none")}
          >
            Verwerfen
          </Button>
        </div>
      </div>
    </DashCard>
  );
}
