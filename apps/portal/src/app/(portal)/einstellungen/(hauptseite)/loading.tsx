import type { ReactNode } from "react";
import { cn } from "@eins/ui";
import { DashCard, QUIET_CONTROL, WASH_AREA, WASH_ROW } from "../../dashboard/_components/dash-ui";
import { ExplainerPopover } from "../../_components/ExplainerPopover";
import { PageHeader } from "../../_components/PageHeader";
import { PlaceIdFinderLink, STERNWERTE_GRID } from "../_components/PlaceIdFinderLink";
import { CardBody, CardFoot, FIELD_GRID, Field, Status } from "../_components/settings-ui";
import { TOC_LABEL } from "../_lib/labels";
import { REMINDER_CONSENT, REMINDER_ENABLE, REVIEW_CONSENT, REVIEW_INTRO, WERBEKONTEN_INTRO } from "../_lib/copy";
import { SECTIONS, START_LINKS } from "../_lib/sections";
import {
  COLUMNS,
  INTERVAL_LIST,
  INTERVAL_ROW,
  LINK_ROW,
  LIST,
  LIST_ROW,
  SKELETON_BAR,
  SLOTS,
  STACK,
  slots,
} from "../_lib/sizes";

const FIELD_SLOT = "elev-inset block h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--well)]";
const BUTTON_SLOT = "block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--well)]";
const RAISED_SLOT = "elev-raised block h-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--surface-raised)]";
/** A row's square button below lg, its word from lg (`ROW_BUTTON`). */
const ROW_BUTTON_SLOT = cn(RAISED_SLOT, "w-[var(--control-h)] lg:w-[8.25rem]");
const SAVE_SLOT = cn(BUTTON_SLOT, "w-[6.75rem]");

/**
 * The Inhaber's Einstellungen (every card) before the data is in: the same
 * cards, labels, fixed sentences, list slots and feet as `page.tsx`, built
 * from the same parts and sizes, so nothing moves when the page arrives
 * (DESIGN.md section 10). Fields are empty wells, values grey bars. It sits
 * in the route group with the page so it wraps only `/einstellungen`; one
 * level up it also wrapped Sicherheit and the Praxis-Software pages, which
 * flashed these fourteen cards before their own skeleton on a full load.
 */
export default function Loading() {
  return (
    <div className={STACK} aria-busy="true" aria-live="polite">
      <PageHeader title="Einstellungen" actions={<span className={cn(RAISED_SLOT, "w-[var(--control-h)] xl:hidden")} />} />
      <div className={COLUMNS}>
        <div className={STACK}>
          <SkCard title="Profil">
            <CardBody>
              <div className={FIELD_GRID}>
                <SkField label="Name" />
                <Field label="E-Mail">
                  <div className="flex h-[var(--control-h)] items-center">
                    <span className={cn(SKELETON_BAR, "h-4 w-48")} />
                  </div>
                </Field>
              </div>
            </CardBody>
            <SkFoot start="Passwort ändern" />
          </SkCard>

          <SkCard title="Team">
            <CardBody className="space-y-5">
              <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <SkField label="Name" />
                <SkField label="E-Mail" />
                <div className="grid gap-4 sm:col-span-2 sm:flex sm:items-end sm:gap-3 xl:col-span-1">
                  <SkField label="Rolle" className="sm:flex-1 xl:w-64 xl:flex-none" />
                  <span className={cn(BUTTON_SLOT, "w-full sm:w-[7.75rem]")} />
                </div>
              </div>
              <SkList n={SLOTS.team} avatar />
            </CardBody>
          </SkCard>

          <SkCard title="Praxis-Angaben">
            <CardBody>
              <div className={FIELD_GRID}>
                <SkField label="Name der Praxis" />
                <SkField label="E-Mail der ärztlichen Leitung" />
                <SkField label="HWG-verantwortliche Person" />
                <SkField label="E-Mail der HWG-verantwortlichen Person" />
              </div>
            </CardBody>
            <SkFoot />
          </SkCard>

          {(
            [
              ["Standorte", ["Name", "Adresse"], SLOTS.standorte],
              ["Behandlungen", ["Name", "Stichwörter"], SLOTS.behandlungen],
            ] as const
          ).map(([title, labels, n]) => (
            <SkCard key={title} title={title}>
              <CardBody className="space-y-5">
                <div className="grid gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
                  <SkField label={labels[0]} />
                  <SkField label={labels[1]} explain={title === "Behandlungen"} />
                  <span className={cn(BUTTON_SLOT, "w-full sm:w-[8.5rem]")} />
                </div>
                <SkList n={n} button />
              </CardBody>
            </SkCard>
          ))}

          <SkCard title="Bewertungen" status>
            <CardBody className="space-y-5">
              <p className="text-[15px] leading-6 text-fg-primary">
                {REVIEW_INTRO.text}
                <span className="font-medium underline underline-offset-4">{REVIEW_INTRO.link}</span>.
              </p>
              <SkCheck label="Bewertungs-Anfragen aktivieren" />
              <SkCheck label="Einwilligung der Praxis bestätigen">{REVIEW_CONSENT}</SkCheck>
              <div className={FIELD_GRID}>
                <SkField label="Google-Bewertungslink" explain />
                <SkField label="Jameda-Bewertungslink" />
                <SkField label="Versand nach dem Termin" />
                <SkField label="E-Mail-Postfach für private Rückmeldungen" />
                <SkField label="Internetadresse für den Link an Patienten" explain className="md:col-span-2" />
              </div>
              <div className="-mx-5 flex min-h-[calc(var(--control-h)+1rem)] items-center justify-between gap-3 border-t border-border px-5 pt-4 md:-mx-6 md:px-6">
                <div className="flex min-w-0 items-center gap-1">
                  <h3 className="text-[15px] font-semibold leading-6 text-fg-primary">Sternwerte</h3>
                  <ExplainerPopover term="Sternwerte">{null}</ExplainerPopover>
                </div>
                <span className={cn(RAISED_SLOT, "w-[9.25rem]")} />
              </div>
              <div className={STERNWERTE_GRID}>
                <SkField label="Google Place-ID" explain aside={<PlaceIdFinderLink />} />
                <SkField label="Jameda-Profil" explain />
              </div>
            </CardBody>
            <SkFoot />
          </SkCard>

          <SkCard
            title={
              <>
                <span className="sm:hidden">Erinnerungen</span>
                <span className="hidden sm:inline">Erinnerungen an Folgebehandlungen</span>
              </>
            }
            explain="Erinnerungen"
            status
          >
            <CardBody className="space-y-5">
              <SkCheck label="Patientinnen und Patienten sind informiert">{REMINDER_CONSENT}</SkCheck>
              <SkCheck label="Erinnerungs-E-Mails einschalten">{REMINDER_ENABLE}</SkCheck>
              <div className={FIELD_GRID}>
                <SkField label="Link zu Ihrer Online-Terminbuchung" />
                <SkField label="Telefonnummer für Termine" />
              </div>
            </CardBody>
            <SkFoot start="So sieht die E-Mail aus" />
          </SkCard>

          <SkCard title="Abstand je Behandlung" explain="Abstand je Behandlung">
            <CardBody>
              <ul className={INTERVAL_LIST} style={slots(SLOTS.abstaende)}>
                {Array.from({ length: SLOTS.abstaende }, (_, i) => (
                  <li key={i} className={INTERVAL_ROW}>
                    <div className="space-y-2 lg:flex-1">
                      <span className={cn(SKELETON_BAR, "block h-4 w-32")} />
                      <span className={cn(SKELETON_BAR, "block h-3.5 w-48")} />
                    </div>
                    <span className={cn(FIELD_SLOT, "lg:w-[22rem]")} />
                  </li>
                ))}
              </ul>
            </CardBody>
            <SkFoot />
          </SkCard>

          <SkCard title="Werbekonten">
            <CardBody>
              <p className="text-[15px] leading-6 text-fg-primary">{WERBEKONTEN_INTRO}</p>
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {[0, 1].map((i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <SkStatusLines />
                    <div className="flex w-full gap-2 lg:w-auto">
                      <span className={cn(RAISED_SLOT, "w-[7.5rem]")} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </SkCard>

          <SkCard title="Praxis-Software">
            <CardBody className="pt-2">
              <div className="flex flex-wrap items-center justify-between gap-3 py-2">
                <SkStatusLines />
                <div className="flex w-full lg:w-auto">
                  <span className={cn(BUTTON_SLOT, "w-[7.5rem]")} />
                </div>
              </div>
            </CardBody>
          </SkCard>

          <SkCard title="Start-Unterlagen">
            <CardBody className="pt-2">
              <ul className="divide-y divide-border">
                {START_LINKS.map((l) => (
                  <SkLinkRow key={l.href} label={l.label} />
                ))}
              </ul>
            </CardBody>
          </SkCard>

          <SkCard title="Protokoll">
            <CardBody>
              <SkList n={SLOTS.protokoll} />
            </CardBody>
          </SkCard>
        </div>
        <div className="hidden xl:block">
          <div className="text-sm font-medium leading-5 text-fg-primary">{TOC_LABEL}</div>
          <ul className="mt-3 border-l border-border">
            {SECTIONS.map((s) => (
              <li key={s.id} className="py-1.5 pl-3 text-sm leading-5 text-fg-secondary">
                {s.title}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * A card as the page draws it: `explain` puts the (i) beside the title,
 * `status` the dot and a bar where "An" or "Aus" stands (same line box).
 */
function SkCard({
  title,
  explain,
  status,
  children,
}: {
  title: ReactNode;
  explain?: string;
  status?: boolean;
  children: ReactNode;
}) {
  return (
    <DashCard
      title={title}
      titleExtra={explain ? <ExplainerPopover term={explain}>{null}</ExplainerPopover> : undefined}
      action={
        status ? (
          <Status tone="none">
            <span className={cn(SKELETON_BAR, "h-3.5 w-6")} />
          </Status>
        ) : undefined
      }
      bodyClassName="p-0 md:p-0"
    >
      {children}
    </DashCard>
  );
}

/** A field as the page draws it, with its (i) and what stands at the label's end. */
function SkField({
  label,
  explain,
  aside,
  className,
}: {
  label: string;
  explain?: boolean;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <Field label={label} explain={explain ? <span /> : undefined} aside={aside} className={className}>
      <span className={FIELD_SLOT} />
    </Field>
  );
}

/** The foot; `start` is the quiet link's fixed words (its icon left blank). */
function SkFoot({ start }: { start?: string }) {
  return (
    <CardFoot
      start={
        start ? (
          <span className={cn(QUIET_CONTROL, "-ml-2.5")}>
            <span className="h-4 w-4" />
            {start}
          </span>
        ) : undefined
      }
    >
      <span className={SAVE_SLOT} />
    </CardFoot>
  );
}

/** The box to tick with its words (they set the row's height). */
function SkCheck({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 h-5 w-5 shrink-0 rounded-[var(--r-mark)] border border-border" />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium leading-6 text-fg-primary">{label}</span>
        {children && <span className="mt-0.5 block text-sm leading-5 text-fg-secondary">{children}</span>}
      </span>
    </div>
  );
}

/** Name and status line of a Werbekonten or Praxis-Software row. */
function SkStatusLines() {
  return (
    <div className="min-w-0">
      <div className="flex h-6 items-center">
        <span className={cn(SKELETON_BAR, "h-4 w-40")} />
      </div>
      <div className="mt-1 flex h-6 items-center">
        <span className={cn(SKELETON_BAR, "h-3.5 w-52")} />
      </div>
    </div>
  );
}

function SkLinkRow({ label }: { label: string }) {
  return (
    <li className={WASH_ROW}>
      <span className={cn(LINK_ROW, WASH_AREA, "text-[15px] font-medium text-fg-primary")}>{label}</span>
    </li>
  );
}

function SkList({ n, avatar, button }: { n: number; avatar?: boolean; button?: boolean }) {
  return (
    <ul className={LIST} style={slots(n)}>
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className={LIST_ROW}>
          {avatar && <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[var(--well)]" />}
          <div className="min-w-0 flex-1 space-y-2">
            <span className={cn(SKELETON_BAR, "block h-4 w-36")} />
            <span className={cn(SKELETON_BAR, "block h-3.5 w-56 max-w-full")} />
          </div>
          {(avatar || button) && <span className={ROW_BUTTON_SLOT} />}
        </li>
      ))}
    </ul>
  );
}
