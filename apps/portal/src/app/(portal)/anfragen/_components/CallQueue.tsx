import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill, Button, cn } from "@eins/ui";
import {
  AlarmClock,
  ArrowRight,
  MessageCircle,
  Mail,
  Phone,
} from "lucide-react";
import { formatDate, formatMoney, formatRelative } from "@/lib/formatting";
import type { CallQueueLead } from "@/server/queries/requests";
import type {
  RetreatmentCall,
  RetreatmentContext,
  RetreatmentTag as RetreatmentTagData,
} from "@/server/queries/retreatments";
import { CONTROL, CONTROL_SQUARE, DashCard, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { CallOutcomeActions } from "./CallOutcomeActions";
import { CallHeroSlot, CallQueueList, CallQueueState, type SlotNode } from "./CallQueueState";
import { Facts } from "./Facts";
import { RetreatmentOutcomeActions } from "./RetreatmentOutcomeActions";
import { RetreatmentTag } from "./RetreatmentTag";
import { RowSignal } from "./RowSignal";
import { TimingLine } from "./TimingLine";
import type { CallItem } from "../_lib/call-items";
import { quizAnswerLines } from "../_lib/quiz-answers";
import { dueShort, dueText, lastCallText, reminderText, tagDetail, tagText } from "../_lib/retreatment-text";
import { rowTiming } from "../_lib/row-timing";
import { ScrollHint } from "@/app/_components/ScrollHint";

/**
 * Call-Center-Karten für die Anfragen-Seite. Wird für jede Rolle mit
 * `requests.update` gerendert (C-20): in kleinen Praxen ruft die Inhaberin
 * selbst zurück, ihre fälligen Wiedervorlagen müssen hier auftauchen.
 *
 * Zwei Karten, nebeneinander ab xl:
 *  - "Jetzt anrufen": der priorisierteste Lead wie Attios Datensatz-Kopf.
 *    Name, direkt darunter die Wege zum Patienten, dann beschriftete Angaben,
 *    die Nachricht und unten das Ergebnis des Anrufs. Alles in dieser Karte
 *    gehört zu diesem einen Patienten.
 *  - "Als Nächstes": die nächsten Leads als Zeilen wie Linears Posteingang,
 *    jede genau zwei Zeilen hoch; rechts der Anruf-Knopf.
 *
 * Fällige Wiederbehandlungen stehen in derselben Warteschlange (Karam,
 * 2026-10-29: keine eigene Karte), in der Reihenfolge von mergeCallItems.
 * Ihre Karte hat dieselben Teile an denselben Stellen, nur mit ihren
 * Angaben, und ihr eigenes Ergebnis des Anrufs.
 *
 * Feste Größe (Karam, 2026-10-29, DESIGN.md Abschnitt 10): beide Karten
 * haben je Breakpoint eine Höhe, egal welcher Patient dran ist, wie lang
 * seine Nachricht ist oder ob die Warteschlange leer ist. Kein Knopf
 * wandert: Angaben, die fehlen, behalten ihre Zeile, Kontaktwege ihren
 * Platz (ausgegraut), Quiz-Antworten und Nachricht scrollen in ihrer Mulde.
 *
 * Optimistisch (Karam, 2026-10-30): ein Tipp auf ein Ergebnis zeigt sofort
 * den nächsten Patienten, "Als Nächstes" rückt um eine Zeile auf, das
 * Speichern läuft im Hintergrund (CallQueueState). Fehler: der Patient ist
 * sofort wieder da (auf der Karte, oder in der ersten Zeile, wenn der
 * Nutzer schon beim nächsten Patienten ist), dazu der Toast.
 *
 * Das Ergebnis ruft dieselbe `logCall`-Action wie das Lead-Cockpit (kein
 * neuer Schreibpfad) und fällt damit in die "Portal-native" Vorbuchungs-Phase
 * (siehe actions.ts). Ist der Lead an einen PVS-Termin gebunden, besitzt die
 * PVS den Status — der Statuswechsel entfällt dann und nur der Anruf wird
 * protokolliert.
 */
/**
 * Height of the "Jetzt anrufen" card (and its skeleton) per breakpoint: the
 * fixed parts plus a text well of three lines (96 px).
 */
export const CALL_CARD_HEIGHT = "h-[39.5rem] sm:h-[36.3125rem]";
/** Number of rows "Als Nächstes" always has room for (the query loads 1 + 5). */
export const QUEUE_SLOTS = 5;
/**
 * Call cards rendered ahead for the optimistic switch to the next patient.
 * One would do for a single tap; a second tap can come while the first save
 * still runs, and each in-flight save uses up one card. A save takes about a
 * second and every card holds a patient's message, so three is room for the
 * fastest realistic caller without sending a card for every row.
 */
export const HERO_CARDS = 3;
/**
 * Calls the page loads per queue (CALL_LOAD in page.tsx, keep both equal): the
 * hero, the rows and a reserve. As many calls as this may mean more waiting.
 */
export const CALLS_LOADED = 8;
/** One queue row, 72 px including the divider; the list is QUEUE_SLOTS of them. */
export const QUEUE_ROW_HEIGHT = "min-h-[4.5rem]";
/** From xl the card stands beside the call card and the list takes its height. */
export const QUEUE_LIST_HEIGHT = "h-[22.5rem] xl:h-auto xl:min-h-0 xl:flex-1";

export function CallQueue({
  items,
  forcedKey = null,
  retreatment,
  callTags,
  dueCount = 0,
  countryCode = "49",
  ruleStart,
}: {
  /** Anfragen and due Wiederbehandlungen in call order (mergeCallItems). */
  items: CallItem[];
  /** The Wiederbehandlung mergeCallItems forced into the last visible place, if any. */
  forcedKey?: string | null;
  /** Today and the reminder setting, for the Wiederbehandlungen among the items. */
  retreatment: RetreatmentContext | null;
  /** Wiederbehandlung of an Anfrage among the items, also while it is worked. */
  callTags?: Map<string, RetreatmentTagData>;
  /** K-3: 48-Werkstunden rule start of the Praxis (signing date). */
  ruleStart?: Date | null;
  /** Clinic-wide count of Wiedervorlagen due now — may exceed the visible rows. */
  dueCount?: number;
  /** Country calling code for national numbers ("0170 ...") in WhatsApp links. */
  countryCode?: string;
}) {
  // A Wiederbehandlung needs its context for the card; the page always sends
  // it along with the calls, so nothing is dropped in practice.
  const calls = items.filter((item) => item.kind === "anfrage" || retreatment);
  const dueLabel = `${dueCount} Wiedervorlage${dueCount === 1 ? "" : "n"} fällig`;

  // Optimistic call cards: a tapped result shows the next patient at once
  // (CallQueueState), so the server renders what could be needed before its
  // next render lands: a card for each of the first HERO_CARDS calls, and a
  // row for every other call it has. The client picks which are on screen.
  const heroNodes: SlotNode[] = calls.slice(0, HERO_CARDS).map((item) => ({
    key: item.key,
    node:
      item.kind === "anfrage" ? (
        <NextCallCard
          lead={item.lead}
          countryCode={countryCode}
          ruleStart={ruleStart}
          retreatment={callTags?.get(item.lead.id)}
          today={retreatment?.today ?? ""}
        />
      ) : (
        <RetreatmentCallCard call={item.call} context={retreatment!} countryCode={countryCode} />
      ),
  }));
  // Enough rows to fill the slots behind a card that is itself HERO_CARDS - 1
  // calls back. The first call has one too: it is the card now, but when its
  // save fails while the user is on the next patient it goes back to the rows.
  const rowNodes: SlotNode[] = calls.slice(0, HERO_CARDS + QUEUE_SLOTS).map((item) => ({
    key: item.key,
    node:
      item.kind === "anfrage" ? (
        <QueueRow lead={item.lead} ruleStart={ruleStart} />
      ) : (
        <RetreatmentQueueRow call={item.call} today={retreatment?.today ?? ""} />
      ),
  }));

  // mergeCallItems forces a Wiederbehandlung into the last visible place when
  // none is among the six (the page tells which, `forcedKey`). It stays in
  // that place while the optimistic list shifts instead of drifting up.
  const pinnedKey = forcedKey;

  // Both cards always, also with nobody to call: after the last saved call
  // the page keeps its shape, and the skeleton matches what comes.
  return (
    <CallQueueState
      order={calls.map((item) => item.key)}
      slots={QUEUE_SLOTS}
      // The page loads CALLS_LOADED per queue (hero, rows and reserve): this
      // many means there may be more.
      loadedCap={CALLS_LOADED}
      cardKeys={heroNodes.map((n) => n.key)}
      pinnedKey={pinnedKey}
    >
      <div className="grid gap-4 md:gap-6 xl:grid-cols-2">
        <CallHeroSlot
          nodes={heroNodes}
          empty={
            <HeroNote
              title="Niemand wartet auf einen Rückruf."
              text="Neue Anfragen erscheinen hier, sobald sie eingehen."
            />
          }
          loading={<HeroNote title="Der nächste Anruf wird geladen." />}
        />
        <DashCard
          title="Als Nächstes"
          // The due count sits in the header, which has one height, instead
          // of a line that comes and goes above the rows.
          titleExtra={
            dueCount > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium leading-5 text-fg-primary"
                title={dueLabel}
              >
                <AlarmClock className="h-4 w-4 text-tone-warn" aria-hidden />
                <span className="sm:hidden" aria-hidden>
                  {dueCount} fällig
                </span>
                <span className="sr-only sm:not-sr-only">{dueLabel}</span>
              </span>
            )
          }
          action={<CardLink href="/anfragen?status=neu,termin_vereinbart">Alle offenen</CardLink>}
          className="flex flex-col [--delay:20ms]"
          bodyClassName="flex flex-1 flex-col"
        >
          {/* Room for QUEUE_SLOTS rows, filled or not; a row whose name wraps
              scrolls the list instead of growing the card. */}
          <CallQueueList
            nodes={rowNodes}
            className={cn(
              "scroll-shadows -mx-2 divide-y divide-border [--scroll-bg:var(--surface-tile)]",
              QUEUE_LIST_HEIGHT
            )}
            empty={
              <div className={cn("flex", QUEUE_LIST_HEIGHT)}>
                <CenteredNote title="Keine weiteren Anrufe offen." />
              </div>
            }
          />
        </DashCard>
      </div>
    </CallQueueState>
  );
}

/** The "Jetzt anrufen" card with one sentence in it: nobody to call, or the next call on its way. */
function HeroNote({ title, text }: { title: string; text?: string }) {
  return (
    <DashCard
      title="Jetzt anrufen"
      className={cn("flex flex-col", CALL_CARD_HEIGHT)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <CenteredNote title={title} text={text} />
    </DashCard>
  );
}

/** One or two sentences in the middle of a card's free space. */
export function CenteredNote({ title, text }: { title: string; text?: string }) {
  return (
    <div className="m-auto max-w-sm px-4 text-center">
      <p className="text-[15px] font-medium leading-6 text-fg-primary">{title}</p>
      {text && <p className="mt-1 text-sm leading-5 text-fg-secondary">{text}</p>}
    </div>
  );
}

/**
 * The name at the top of the call card, in a block of one fixed height (two
 * lines of the small sizes, one of the large): long names step down a size
 * and may take two lines, so the contact buttons under the block never move.
 */
export const NAME_BLOCK = "flex h-10 shrink-0 overflow-y-auto";
/**
 * A Behandlung the patient typed in themself can be a sentence. Longer than
 * this it would wrap its row several times, so it goes into the text well
 * ("Wunsch") and the row points there.
 */
const WISH_IN_ROW_MAX = 40;
export function nameSize(name: string): string {
  const n = name.length;
  if (n <= 20) return "text-2xl leading-8";
  if (n <= 24) return "text-xl leading-8 sm:text-2xl";
  if (n <= 34) return "text-lg leading-5 sm:text-2xl sm:leading-8";
  if (n <= 40) return "text-base leading-5 sm:text-xl sm:leading-8";
  return "text-sm leading-5 sm:text-lg";
}

/**
 * The next call as one card, like Attio's record header: the name, the ways
 * to reach this patient directly under it, then the details as label and
 * value pairs, the message in a well, and the result of the call at the
 * foot. Nothing in the card acts on anyone else.
 */
function NextCallCard({
  lead,
  countryCode,
  ruleStart,
  retreatment,
  today,
}: {
  lead: CallQueueLead;
  countryCode: string;
  ruleStart?: Date | null;
  /** A Wiederbehandlung of this patient, due or within 90 days (callTags). */
  retreatment?: RetreatmentTagData;
  today: string;
}) {
  const name = lead.contactName ?? "Unbekannt";
  const answers = quizAnswerLines(lead.quiz);
  const timing = timingOf(lead, ruleStart);
  const followupDue = isFollowupDue(lead);
  const longWish =
    !lead.treatmentName && lead.treatmentWish && lead.treatmentWish.length > WISH_IN_ROW_MAX
      ? lead.treatmentWish
      : null;
  const wellPairs = longWish ? [{ label: "Wunsch", value: longWish }, ...answers] : answers;

  return (
    <DashCard
      title="Jetzt anrufen"
      action={<CardLink href={`/anfragen/${lead.id}`}>Details öffnen</CardLink>}
      className={cn("flex flex-col", CALL_CARD_HEIGHT)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className={NAME_BLOCK}>
        <h3 className={cn("my-auto min-w-0 break-words font-semibold text-fg-primary", nameSize(name))}>
          {name}
        </h3>
      </div>

      <ContactButtons phone={lead.contactPhone} email={lead.contactEmail} countryCode={countryCode} />

      {/* Attio's record details: every fact with its label. The same five
          rows for every patient; a missing fact says so in its row. */}
      <dl className="mt-5 grid shrink-0 grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[15px] leading-5">
        <Detail label="Status">
          <StatusPill status={lead.status} />
        </Detail>
        <Detail label="Frist">
          {timing || followupDue ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {timing && <TimingLine timing={timing} explain className="text-[15px]" />}
              {followupDue && <FollowupDue />}
            </span>
          ) : (
            <span className="text-fg-secondary">Keine offene Frist</span>
          )}
        </Detail>
        <Detail label="Behandlung">
          {longWish ? (
            <span className="text-fg-secondary">Wunsch steht unten</span>
          ) : (
            (lead.treatmentName ?? lead.treatmentWish ?? "Keine Angabe")
          )}
        </Detail>
        <Detail label="Telefon">
          {lead.contactPhone ? (
            <span className="tabular-nums">{lead.contactPhone}</span>
          ) : (
            <span className="text-fg-secondary">Keine Telefonnummer</span>
          )}
        </Detail>
        <Detail label="Eingang">
          <span className="tabular-nums">{formatRelative(lead.createdAt)}</span>
        </Detail>
      </dl>

      {/* What the patient wrote, in a well of three lines (Karam: "normal
          sized like before", you scroll inside it when the text is longer):
          the message, then the quiz answers. A shadow at the edge shows there
          is more; nothing is cut and the card keeps its size. A patient who
          is also due for a Wiederbehandlung has it on the first line, so the
          one call covers both (the old calendar card showed them too). */}
      <ScrollHint className="mt-5 flex min-h-0 flex-1 flex-col">
        <div
          role="region"
          aria-label="Angaben und Nachricht"
          tabIndex={0}
          className="scroll-shadows elev-inset min-h-0 flex-1 rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {retreatment && (
            <p className="mb-2 flex flex-wrap items-baseline gap-x-2">
              <RetreatmentTag
                state={retreatment.state}
                text={`${tagText(retreatment.state, retreatment.call, today)}${
                  retreatment.count > 1 ? `, dazu ${retreatment.count - 1} weitere` : ""
                }`}
              />
              <span aria-hidden className="text-fg-secondary">
                {tagDetail(retreatment.state, retreatment.call, today)}
                {retreatment.count > 1 && `, dazu ${retreatment.count - 1} weitere`}
              </span>
            </p>
          )}
          {lead.message ? (
            <p className="whitespace-pre-line break-words">{lead.message}</p>
          ) : (
            <p className="text-fg-secondary">Keine Nachricht hinterlassen.</p>
          )}
          {wellPairs.length > 0 && (
            <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              {wellPairs.map((a) => (
                <Detail key={a.label} label={a.label}>
                  {a.value}
                </Detail>
              ))}
            </dl>
          )}
        </div>
      </ScrollHint>

      <div className="shrink-0 pt-5">
        <div className="border-t border-border pt-4">
          {/* Not keyed: the switch is the same for every patient; the toast
              says whose call was saved. */}
          <CallOutcomeActions
            requestId={lead.id}
            name={name}
            currentStatus={lead.status}
            pvsControlled={lead.pvsControlled}
          />
        </div>
      </div>
    </DashCard>
  );
}

/**
 * A due Wiederbehandlung as the next call: the same card as for an Anfrage,
 * part for part, so nothing moves when one follows the other. The details
 * are its own (when due, the treatment, when last treated and for how
 * much), the well holds the reminder, the last call and what the patient
 * wrote back then, and the result of the call is its own
 * (RetreatmentOutcomeActions).
 */
function RetreatmentCallCard({
  call,
  context,
  countryCode,
}: {
  call: RetreatmentCall;
  context: RetreatmentContext;
  countryCode: string;
}) {
  const name = call.patientName?.trim() || "Ohne Namen";
  const { today } = context;
  const paid =
    call.cycleRevenueCents && call.cycleRevenueCents > 0
      ? formatMoney(call.cycleRevenueCents / 100, context.currency)
      : null;
  const lastCall = lastCallText(call);

  return (
    <DashCard
      title="Jetzt anrufen"
      action={call.requestId && <CardLink href={`/anfragen/${call.requestId}`}>Details öffnen</CardLink>}
      className={cn("flex flex-col", CALL_CARD_HEIGHT)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className={NAME_BLOCK}>
        <h3 className={cn("my-auto min-w-0 break-words font-semibold text-fg-primary", nameSize(name))}>
          {name}
        </h3>
      </div>

      <ContactButtons phone={call.patientPhone} email={call.patientEmail} countryCode={countryCode} />

      {/* The same five rows as an Anfrage's card. */}
      <dl className="mt-5 grid shrink-0 grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[15px] leading-5">
        <Detail label="Status">
          <RetreatmentTag state="faellig" text={tagText("faellig", call, today)} />
        </Detail>
        <Detail label="Fällig">{dueText(call, today)}</Detail>
        <Detail label="Behandlung">{call.treatmentName}</Detail>
        <Detail label="Telefon">
          {call.patientPhone ? (
            <span className="tabular-nums">{call.patientPhone}</span>
          ) : (
            <span className="text-fg-secondary">Keine Telefonnummer</span>
          )}
        </Detail>
        <Detail label="Zuletzt">
          <span className="tabular-nums">
            {formatDate(call.cycleOn)}
            {paid && `, ${paid} bezahlt`}
          </span>
        </Detail>
      </dl>

      <ScrollHint className="mt-5 flex min-h-0 flex-1 flex-col">
        <div
          role="region"
          aria-label="Erinnerung, Anrufe und Nachricht"
          tabIndex={0}
          className="scroll-shadows elev-inset min-h-0 flex-1 rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <Detail label="Erinnerung">{reminderText(call, today, context.remindersEnabled)}</Detail>
            {lastCall && <Detail label="Letzter Anruf">{lastCall}</Detail>}
            <Detail label="Nachricht">
              {call.requestMessage ? (
                <>
                  {call.requestCreatedAt && (
                    <span className="block text-sm text-fg-secondary">
                      Mit der Anfrage vom {formatDate(call.requestCreatedAt)}
                    </span>
                  )}
                  <span className="whitespace-pre-line">{call.requestMessage}</span>
                </>
              ) : (
                <span className="text-fg-secondary">Keine Nachricht hinterlassen.</span>
              )}
            </Detail>
          </dl>
        </div>
      </ScrollHint>

      <div className="shrink-0 pt-5">
        <div className="border-t border-border pt-4">
          <RetreatmentOutcomeActions cycleId={call.id} name={name} />
        </div>
      </div>
    </DashCard>
  );
}

/**
 * A due Wiederbehandlung among the next calls: the same two lines as an
 * Anfrage's row, with since when it is due on the right and the tag and the
 * Behandlung below. The row opens the Anfrage the patient came with.
 */
function RetreatmentQueueRow({ call, today }: { call: RetreatmentCall; today: string }) {
  const name = call.patientName?.trim() || "Ohne Namen";
  const phoneHref = call.patientPhone ? `tel:${call.patientPhone}` : null;
  const body = (
    <>
      {/* The empty signal slot keeps the names in one column. */}
      <span aria-hidden className="h-5 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words text-[15px] font-medium leading-5 text-fg-primary">{name}</span>
          <span className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary" title={dueText(call, today)}>
            {dueShort(call, today)}
          </span>
        </span>
        <Facts>
          <RetreatmentTag state="faellig" text={tagText("faellig", call, today)} />
          {call.treatmentName}
        </Facts>
      </span>
    </>
  );
  const bodyClass =
    "flex min-w-0 flex-1 items-start gap-2.5 rounded-[var(--r-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-2 py-3 transition-colors hover:bg-[var(--hover-wash)]",
        QUEUE_ROW_HEIGHT
      )}
    >
      {call.requestId ? (
        <Link href={`/anfragen/${call.requestId}`} className={bodyClass}>
          {body}
        </Link>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}

      {phoneHref ? (
        <Button
          asChild
          variant="outline"
          className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "shrink-0")}
          title={call.patientPhone ?? undefined}
        >
          <a href={phoneHref} aria-label={`${name} anrufen: ${call.patientPhone}`}>
            <Phone className="h-4 w-4" aria-hidden />
          </a>
        </Button>
      ) : (
        <span aria-hidden className="w-[var(--control-h)] shrink-0" />
      )}
    </li>
  );
}

/**
 * The ways to reach a patient, under the name of a call card: the main
 * action wide and dark, the other ways raised beside it (Attio's action row).
 * Three fixed slots: a way this patient has not given stays in its place,
 * greyed out, so no button moves between patients.
 */
export function ContactButtons({
  phone,
  email,
  countryCode,
}: {
  phone: string | null;
  email: string | null;
  countryCode: string;
}) {
  const phoneHref = phone ? `tel:${phone}` : null;
  const whatsappHref = waMeHref(phone, countryCode);
  const emailHref = email ? `mailto:${email}` : null;
  return (
    <div className="mt-4 grid shrink-0 grid-cols-2 gap-2 sm:flex">
      {phoneHref ? (
        <Button asChild className={cn(CONTROL, "col-span-2 px-5")}>
          <a href={phoneHref}>
            <Phone className="h-4 w-4" aria-hidden />
            Anrufen
          </a>
        </Button>
      ) : (
        <Button disabled className={cn(CONTROL, "col-span-2 px-5")} title="Keine Telefonnummer hinterlegt">
          <Phone className="h-4 w-4" aria-hidden />
          Anrufen
        </Button>
      )}
      {whatsappHref ? (
        <Button asChild variant="outline" className={cn(RAISED_CONTROL, CONTROL, "px-4")}>
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" aria-hidden />
            WhatsApp
          </a>
        </Button>
      ) : (
        <Button
          disabled
          variant="outline"
          className={cn(RAISED_CONTROL, CONTROL, "px-4")}
          title="Keine Telefonnummer hinterlegt"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          WhatsApp
        </Button>
      )}
      {emailHref ? (
        <Button asChild variant="outline" className={cn(RAISED_CONTROL, CONTROL, "px-4")}>
          <a href={emailHref} title={email ?? undefined}>
            <Mail className="h-4 w-4" aria-hidden />
            E-Mail
          </a>
        </Button>
      ) : (
        <Button
          disabled
          variant="outline"
          className={cn(RAISED_CONTROL, CONTROL, "px-4")}
          title="Keine E-Mail-Adresse hinterlegt"
        >
          <Mail className="h-4 w-4" aria-hidden />
          E-Mail
        </Button>
      )}
    </div>
  );
}

/** One label and value pair of the record details. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm leading-[inherit] text-fg-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-fg-primary">{children}</dd>
    </>
  );
}

/**
 * One of the next calls, like a row of Linear's inbox: exactly two lines
 * (the name with the date on the right, then status and Behandlung), the
 * signal in its slot before the name, the call button at the end.
 */
function QueueRow({ lead, ruleStart }: { lead: CallQueueLead; ruleStart?: Date | null }) {
  const name = lead.contactName ?? "Unbekannt";
  const phoneHref = lead.contactPhone ? `tel:${lead.contactPhone}` : null;

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-2 py-3 transition-colors hover:bg-[var(--hover-wash)]",
        QUEUE_ROW_HEIGHT
      )}
    >
      <Link
        href={`/anfragen/${lead.id}`}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-[var(--r-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <RowSignal timing={timingOf(lead, ruleStart)} followupDue={isFollowupDue(lead)} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-[15px] font-medium leading-5 text-fg-primary">
              {name}
            </span>
            <span className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary">
              {formatRelative(lead.createdAt)}
            </span>
          </span>
          <Facts>
            <StatusPill status={lead.status} />
            {lead.treatmentName ?? lead.treatmentWish ?? "Keine Angabe"}
          </Facts>
        </span>
      </Link>

      {phoneHref ? (
        <Button
          asChild
          variant="outline"
          className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "shrink-0")}
          title={lead.contactPhone ?? undefined}
        >
          <a href={phoneHref} aria-label={`${name} anrufen: ${lead.contactPhone}`}>
            <Phone className="h-4 w-4" aria-hidden />
          </a>
        </Button>
      ) : (
        // Keeps the dates of all rows in one column.
        <span aria-hidden className="w-[var(--control-h)] shrink-0" />
      )}
    </li>
  );
}

/** The one quiet link in a card header, with an arrow. */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-[var(--r-small)] text-sm font-medium text-fg-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** "Wiedervorlage fällig" as an icon and dark text, no badge. */
function FollowupDue() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-primary">
      <AlarmClock className="h-3.5 w-3.5 text-tone-warn" aria-hidden />
      Wiedervorlage fällig
    </span>
  );
}

/** The one timing (Frist, Rückruf-Ziel, flags), shared with the list. */
function timingOf(lead: CallQueueLead, ruleStart?: Date | null) {
  return rowTiming(
    {
      createdAt: lead.createdAt,
      firstAttemptAt: lead.firstAttemptAt,
      status: lead.status,
      ruleStart,
      firstContactedAt: lead.firstContactedAt,
      slaRespondBy: lead.slaRespondBy,
    },
    new Date()
  );
}

function isFollowupDue(lead: CallQueueLead): boolean {
  return !!lead.nextFollowupAt && lead.nextFollowupAt.getTime() <= Date.now();
}

/**
 * Strip phone formatting to a wa.me-compatible E.164-ish digits string.
 * The "(0)" in "+49 (0) 170 ..." is dropped first (C-32). Leading `00` or
 * `+` → drop; leading `0` (national) → the Praxis' country code. Returns
 * null if too few digits to be a real number.
 */
export function waMeHref(phone: string | null, countryCode: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\(\s*0\s*\)/g, "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}
