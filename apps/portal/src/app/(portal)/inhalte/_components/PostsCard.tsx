"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Download, Image as ImageIcon } from "lucide-react";
import { Button, cn } from "@eins/ui";
import {
  CONTROL,
  CONTROL_SQUARE,
  DashCard,
  RAISED_CONTROL,
  TABLE_HEAD_BAND,
  WASH_AREA,
  WASH_ROW,
} from "../../dashboard/_components/dash-ui";
import { FORMAT_ICON, POST_STATUS, type PostRow } from "../_lib/view";
import { DownloadAllButton } from "./DownloadAllButton";
import { MediaViewer, type ViewerItem } from "./MediaViewer";
import {
  CenteredNote,
  Detail,
  PAGE_SIZE,
  Pager,
  POST_ROW,
  POSTS_CARD_HEIGHT,
  StatusDot,
  replaceParam,
} from "./parts";

/**
 * The picture's column, then the rest of the row. The picture is square on
 * the phone and wide from lg (the Übersicht's Inhalte table).
 */
const ROW_GRID = "grid-cols-[3rem_minmax(0,1fr)] lg:grid-cols-[5.25rem_minmax(0,1fr)]";

/**
 * Columns right of the picture from lg; the Format joins from xl. Below lg a
 * row is the title and one grey line (status, date, Anfragen), like the
 * Anfragen list; on the phone the date waits in the opened row, so the line
 * fits beside the picture. Hidden cells take no column, so the chevron always
 * ends the row.
 */
const COLUMNS =
  "grid-cols-[minmax(0,1fr)_1.25rem] lg:grid-cols-[minmax(0,1fr)_10.5rem_6.5rem_5.5rem_1.25rem] xl:grid-cols-[minmax(0,1fr)_8.5rem_10.5rem_6.5rem_5.5rem_1.25rem]";

/**
 * Every post EINS made for the Praxis, newest first (Stripe's invoice list),
 * with its file (Frame.io's and Drive's file lists): one row per post with
 * its picture, its status as a dot and plain text, the date its status began
 * and the Anfragen it brought. The picture opens the file large (`MediaViewer`).
 * A row opens everything else about the post under it: the file to view and
 * download, the change asked for, why it was stopped, the Anfragen by
 * channel, where it is online and its text. A post that waits for the Praxis
 * opens in "Zur Freigabe" from there. "Alle herunterladen" in the header
 * saves the file of every post as a ZIP.
 *
 * Fixed size: six rows a page, the pages at the foot only when there is more
 * than one. An opened post longer than the free room scrolls the list.
 */
export function PostsCard({ rows, practiceName }: { rows: PostRow[]; practiceName: string }) {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  // Index in `files` of the file open in the viewer.
  const [viewing, setViewing] = useState<number | null>(null);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const at = Math.min(page, pages);
  const shown = rows.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE);
  const files: ViewerItem[] = rows.flatMap((r) => (r.file ? [{ id: r.id, title: r.title, file: r.file }] : []));

  const toPage = (next: number) => {
    setPage(next);
    setOpenId(null);
  };
  // Closing the viewer leaves the list on the page of the last file seen.
  const view = (next: number | null) => {
    if (next == null && viewing != null) {
      const index = rows.findIndex((r) => r.id === files[viewing]?.id);
      const target = Math.floor(Math.max(index, 0) / PAGE_SIZE) + 1;
      if (target !== at) toPage(target);
    }
    setViewing(next);
  };
  const viewPost = (id: string) => view(files.findIndex((f) => f.id === id));

  return (
    <DashCard
      id="beitraege"
      title={
        <>
          Alle Beiträge
          {rows.length > 0 && <span className="ml-2 font-normal tabular-nums text-fg-secondary">{rows.length}</span>}
        </>
      }
      action={<DownloadAllButton practiceName={practiceName} hidden={files.length === 0} />}
      className={cn("flex scroll-mt-4 flex-col", POSTS_CARD_HEIGHT)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      {rows.length === 0 ? (
        <CenteredNote
          title="Noch keine Beiträge."
          text="Hier erscheint jeder Beitrag, sobald EINS ihn Ihnen zur Freigabe schickt."
        />
      ) : (
        <>
          <div aria-hidden className={cn("hidden shrink-0 items-center gap-x-1 lg:grid", TABLE_HEAD_BAND, WASH_AREA, ROW_GRID)}>
            <span>Beitrag</span>
            <span className={cn("grid items-center gap-x-4 px-2", COLUMNS)}>
              <span />
              <span className="hidden xl:block">Format</span>
              <span>Status</span>
              <span>Seit</span>
              <span className="text-right">Anfragen</span>
              <span />
            </span>
          </div>
          {/* Rows that wrap on a narrow screen scroll here instead of
              stretching the card. */}
          <ul className="scroll-shadows -mx-3 min-h-0 flex-1 divide-y divide-border px-3 [--scroll-bg:var(--surface-tile)] lg:mt-1">
            {shown.map((row) => (
              <PostListItem
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
                onView={() => viewPost(row.id)}
              />
            ))}
          </ul>
          {pages > 1 && <Pager page={at} pages={pages} onPage={toPage} label="Seiten der Beiträge" />}
        </>
      )}
      <MediaViewer rows={files} index={viewing} onIndex={view} />
    </DashCard>
  );
}

function PostListItem({
  row,
  open,
  onToggle,
  onView,
}: {
  row: PostRow;
  open: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  const status = POST_STATUS[row.status];
  const panelId = `beitrag-${row.id}`;
  const anfragen =
    row.anfragen == null ? null : `${row.anfragen} ${row.anfragen === 1 ? "Anfrage" : "Anfragen"}`;
  return (
    <li className={WASH_ROW}>
      {/* A hovered or open row is marked whole, picture included, 12 px
          past it at the sides and 4 px short of the hairlines. */}
      <div
        className={cn(
          "grid items-center gap-x-1 rounded-[var(--r-panel)] transition-colors hover:bg-[var(--hover-wash)]",
          WASH_AREA,
          ROW_GRID,
          POST_ROW,
          open && "bg-[var(--hover-wash)]"
        )}
      >
        <Thumb row={row} onView={onView} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "grid h-full w-full items-center gap-x-4 rounded-[var(--r-panel)] px-2 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            COLUMNS
          )}
        >
          <span className="min-w-0">
            {/* Long titles wrap, never cut. */}
            <span className="block break-words text-[15px] font-medium leading-5 text-fg-primary">{row.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-sm leading-5 text-fg-secondary lg:hidden">
              <StatusDot dot={status.dot}>{status.label}</StatusDot>
              <span aria-hidden className="hidden sm:inline">
                ·
              </span>
              <span className="hidden tabular-nums sm:inline">{row.since}</span>
              {anfragen && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{anfragen}</span>
                </>
              )}
            </span>
          </span>
          <span className="hidden text-[15px] leading-5 text-fg-primary xl:block">{row.formatLabel}</span>
          <span className="hidden lg:block">
            <StatusDot dot={status.dot}>{status.label}</StatusDot>
          </span>
          <span className="hidden text-[15px] leading-5 tabular-nums text-fg-primary lg:block">{row.since}</span>
          <span className="hidden text-right text-[15px] font-medium leading-5 tabular-nums text-fg-primary lg:block">
            {row.anfragen != null && (
              <>
                <span className="sr-only">Anfragen: </span>
                {row.anfragen}
              </>
            )}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("h-5 w-5 text-fg-secondary transition-transform duration-200", open && "rotate-180")}
          />
        </button>
      </div>
      {open && <PostDetails row={row} panelId={panelId} onView={onView} />}
    </li>
  );
}

const THUMB_BOX = "h-12 w-12 rounded-[var(--r-control)] lg:w-[5.25rem]";

/**
 * The post's picture: the poster or the image itself, a video without a
 * poster its first frame, else its format as an icon in a well. With a file
 * it opens the file large in one tap (Drive's preview); a post without a file
 * shows the icon only.
 */
function Thumb({ row, onView }: { row: PostRow; onView: () => void }) {
  const Icon = FORMAT_ICON[row.format] ?? ImageIcon;
  const picture = row.file?.isVideo && !row.file.thumbUrl ? (
    <video
      src={`${row.file.url}#t=0.5`}
      preload="metadata"
      muted
      playsInline
      tabIndex={-1}
      aria-hidden
      className={cn("pointer-events-none block bg-[var(--well)] object-cover", THUMB_BOX)}
    />
  ) : row.file?.thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage and Mux links, no image optimiser
    <img
      src={row.file.thumbUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("block bg-[var(--well)] object-cover", THUMB_BOX)}
    />
  ) : (
    <span
      className={cn(
        "elev-inset flex items-center justify-center bg-[var(--well)]",
        row.file ? "text-fg-secondary" : "text-fg-tertiary",
        THUMB_BOX
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
  if (!row.file) return picture;
  return (
    <button
      type="button"
      onClick={onView}
      aria-label={`Ansehen: ${row.title}`}
      className="rounded-[var(--r-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {picture}
    </button>
  );
}

/**
 * Everything else about one post, in plain text under its row, lined up with
 * the title from sm. Shown whole: no box, nothing cut (Karam, 2026-10-30).
 */
function PostDetails({ row, panelId, onView }: { row: PostRow; panelId: string; onView: () => void }) {
  const facts: Array<{ label: string; value: ReactNode; className?: string }> = [];
  facts.push({ label: "Format", value: row.formatLabel });
  // The row's grey line leaves the date out on the phone.
  facts.push({ label: "Seit", value: <span className="tabular-nums">{row.since}</span>, className: "sm:hidden" });
  // A fact that is sometimes missing keeps its row (DESIGN.md section 10).
  facts.push({
    label: "Datei",
    value: row.file ? (
      <span className="tabular-nums">{row.file.facts}</span>
    ) : (
      <span className="text-fg-secondary">Noch keine Datei</span>
    ),
  });
  if (row.waiting) {
    facts.push({
      label: "Frist",
      value: row.dueLabel ? <span className="tabular-nums">Bis {row.dueLabel}</span> : "Noch keine Frist",
    });
  }
  if (row.decision) facts.push({ label: "Entscheidung", value: row.decision });
  if (row.changeText) {
    facts.push({ label: "Ihr Wunsch", value: <span className="whitespace-pre-wrap">{row.changeText}</span> });
  }
  if (row.stopReason) facts.push({ label: "Grund", value: row.stopReason });
  if (row.anfragen != null) facts.push({ label: "Anfragen", value: row.channels ?? "Noch keine" });
  if (row.links.length > 0) {
    facts.push({
      label: "Online",
      value: (
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {row.links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-fg-primary underline underline-offset-4"
            >
              {l.label}
            </a>
          ))}
        </span>
      ),
    });
  }

  const actions = (
    <>
      {row.file && (
        <>
          <Button type="button" variant="outline" onClick={onView} className={cn(RAISED_CONTROL, CONTROL, "px-3")}>
            Ansehen
          </Button>
          {/* A square on the phone, so three buttons share one line. */}
          <Button
            asChild
            variant="outline"
            className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE, "sm:w-auto sm:gap-2 sm:px-3")}
          >
            <a href={row.file.downloadUrl} download aria-label={`Herunterladen: ${row.title}`}>
              <Download className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Herunterladen</span>
            </a>
          </Button>
        </>
      )}
      {row.waiting && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            replaceParam("beitrag", row.id, "freigabe");
            document.getElementById("freigabe")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={cn(RAISED_CONTROL, CONTROL, "px-3")}
        >
          <span className="sm:hidden">Zur Freigabe</span>
          <span className="hidden sm:inline">In der Freigabe öffnen</span>
        </Button>
      )}
    </>
  );

  return (
    <div id={panelId} role="region" aria-label={row.title} className={cn("grid gap-x-1 pb-6 pt-5", ROW_GRID)}>
      <div className="col-span-2 px-2 text-[15px] leading-5 sm:col-span-1 sm:col-start-2">
        {/* Air between the facts, no lines (Karam, 2026-10-30). */}
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-4">
          {facts.map((f) => (
            <Detail key={f.label} label={f.label} className={f.className}>
              {f.value}
            </Detail>
          ))}
          <Detail label="Text">
            {row.caption ? (
              <span className="block whitespace-pre-wrap leading-6">{row.caption}</span>
            ) : (
              <span className="text-fg-secondary">Dieser Beitrag hat keinen Text.</span>
            )}
          </Detail>
        </dl>
        {(row.file || row.waiting) && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
