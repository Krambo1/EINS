import type { ReactNode } from "react";
import {
  BookOpen,
  CheckCheck,
  ClipboardCheck,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@eins/ui";
import { formatDateTime } from "@/lib/formatting";
import { fileExtension, isVideoExtension } from "@/lib/uploads";
import { DashCard } from "../../dashboard/_components/dash-ui";

/**
 * Building blocks of the Dateien page, shared by the page and its skeleton so
 * both have the same frame (DESIGN.md section 10, "Fixed size").
 *
 * A card has one height on every width: the header row, six row slots and the
 * foot with the page buttons all have fixed heights. Fewer files leave slots
 * empty, more files go on the next page; a name long enough to wrap scrolls
 * inside the list instead of growing the card.
 */
export const FILE_SLOTS = 6;

/** One row: two lines of 20 px, 12 px above and below (68 px). */
export const FILE_ROW = "min-h-[4.25rem] py-3";

/** Six rows. No hairlines between them: Attio's file rows are told apart by
 *  their rounded hover wash. Below lg most names take two lines (six 88 px
 *  rows); from lg one (six 68 px rows plus room for one name that wraps). */
const FILE_LIST_HEIGHT = "h-[33rem] lg:h-[26.75rem]";

/** The list of a card (FileListRows on the page, the skeleton's rows). */
export const FILE_LIST = cn("scroll-shadows -mx-2 [--scroll-bg:var(--surface-tile)]", FILE_LIST_HEIGHT);

/** The foot: a hairline, 12 px, one control. */
const FILE_FOOT_HEIGHT = "h-[calc(var(--control-h)+0.75rem+1px)]";

/** Placeholder bar of the skeleton. */
export const SKELETON_BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";

/**
 * A card of the page ("Von EINS", "An EINS gesendet"): Attio's Files tab
 * (title, count, the section's control at the right end), Linear's group
 * header count. The header is one control high whether or not the card has a
 * control, so both cards of a row line up. `children` is the list space:
 * a `FILE_LIST` list or `FileEmpty`.
 */
export function FilesCard({
  id,
  title,
  count,
  action,
  foot,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  /** After the title (FileCount, FileListCount). */
  count?: ReactNode;
  action?: ReactNode;
  /** Page buttons; the foot keeps its height without them. */
  foot?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <DashCard
      id={id}
      title={
        <>
          {title}
          {count}
        </>
      }
      action={action ?? <span aria-hidden className="block h-[var(--control-h)]" />}
      className={cn("flex scroll-mt-6 flex-col", className)}
      bodyClassName="flex flex-1 flex-col"
    >
      {children}
      <div className={cn("-mx-2 mt-auto", FILE_FOOT_HEIGHT)}>{foot}</div>
    </DashCard>
  );
}

/** The number of files, grey after the card title; none for zero. */
export function FileCount({ n }: { n: number }) {
  return n > 0 ? <span className="ml-2 font-normal tabular-nums text-fg-secondary">{n}</span> : null;
}

/** One sentence in the middle of the list space, when there are no rows. */
export function FileEmpty({ children }: { children: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-center px-4 text-center", FILE_LIST_HEIGHT)}>
      <p className="text-[15px] text-fg-secondary">{children}</p>
    </div>
  );
}

/** A quiet line in an empty foot (no page buttons), for a mouse only. */
export function FootHint({ children }: { children: ReactNode }) {
  return (
    <p className="hidden h-full items-end px-2 [@media(pointer:fine)]:flex">
      <span className="flex h-[var(--control-h)] items-center text-sm text-fg-tertiary">{children}</span>
    </p>
  );
}

/**
 * One file: the type icon in a fixed slot, the name (wraps, never cut) and
 * one meta line, the row's one action at the end (Attio's file rows, Linear's
 * two-line inbox rows). The name opens the file.
 */
export function FileRow({
  icon,
  name,
  href,
  meta,
  action,
  previewId,
  fresh = false,
}: {
  icon: ReactNode;
  name: string;
  href: string;
  meta: ReactNode;
  action: ReactNode;
  /** A click on the name opens the preview (FilePreview) instead of a tab. */
  previewId?: string;
  /** Sent a moment ago: the row lights up once (Drive's new-file wash). */
  fresh?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-[var(--r-control)] px-2 transition-[background-color] hover:bg-[var(--hover-wash)]",
        FILE_ROW,
        fresh && "anim-fresh"
      )}
    >
      <span aria-hidden className="flex h-5 w-4 shrink-0 items-center justify-center self-start text-fg-tertiary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-preview-id={previewId}
          className="block break-words rounded-[var(--r-small)] text-[15px] font-medium leading-5 text-fg-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {name}
        </a>
        <div className="mt-1 min-h-5 min-w-0 text-sm leading-5 text-fg-secondary">{meta}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

/**
 * Facts of a meta line, joined by dots. Each fact carries its dot in front;
 * the strip sits one dot to the left and the box cuts that column off, so
 * when the line wraps no dot ever starts or ends a line.
 */
export function MetaFacts({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter((p) => p != null && p !== false && p !== "");
  return (
    <span className="block overflow-hidden">
      <span className="-ml-4 flex flex-wrap items-center">
        {shown.map((p, i) => (
          <span
            key={i}
            className="inline-flex min-w-0 items-center break-words before:w-4 before:shrink-0 before:text-center before:content-['·']"
          >
            {p}
          </span>
        ))}
      </span>
    </span>
  );
}

/** A file from EINS added in the last days: a dot and "Neu", no pill. */
export function NewMark() {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-fg-primary">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
      Neu
    </span>
  );
}

/**
 * Status of a sent file, read like WhatsApp's ticks: two grey ticks when it
 * arrived at EINS, the same two in the accent once EINS has opened it. The
 * word stays beside them, so the colour is never the only signal; hovering
 * shows when EINS saw it.
 */
export function SeenStatus({ seenAt }: { seenAt: Date | null }) {
  const seen = seenAt != null;
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-fg-primary"
      title={seen ? `Von EINS gesehen am ${formatDateTime(seenAt)}` : "Bei EINS angekommen, noch nicht geöffnet"}
    >
      <CheckCheck
        aria-hidden
        strokeWidth={2.25}
        className={cn("h-4 w-4 shrink-0", seen ? "text-accent-pressed" : "text-fg-tertiary")}
      />
      {seen ? "Gesehen" : "Übermittelt"}
    </span>
  );
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "heic", "heif", "gif"];

/** Grey glyph by file type (Attio's type icons, without their colours). */
export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  const ext = fileExtension(name);
  const cls = cn("h-4 w-4 shrink-0", className);
  if (isVideoExtension(ext)) return <Film className={cls} />;
  if (IMAGE_EXTENSIONS.includes(ext)) return <ImageIcon className={cls} />;
  if (ext === "pdf" || ext === "doc" || ext === "docx" || ext === "txt") return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}

export const PinnedIcons = { anleitung: BookOpen, checkliste: ClipboardCheck } as const;

const sizeFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const gbFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** File size with a German decimal comma ("4,6 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${sizeFormatter.format(bytes / (1024 * 1024))} MB`;
  return `${gbFormatter.format(bytes / (1024 * 1024 * 1024))} GB`;
}
