import { Fragment, type ReactNode } from "react";

/**
 * Lightweight server-side markdown renderer for legal pages.
 *
 * Only what we actually need: paragraphs, ## h2, ### h3, **bold**, [text](url),
 * unordered lists, blank-line separators. No HTML pass-through, no remark,
 * no sanitizer dependency. ~60 LOC instead of 80kb of library.
 */
export function renderMarkdown(md: string): ReactNode {
  const blocks = md.replace(/\r\n/g, "\n").trim().split(/\n\n+/);
  return blocks.map((block, i) => <Fragment key={i}>{renderBlock(block, i)}</Fragment>);
}

function renderBlock(block: string, key: number): ReactNode {
  if (block.startsWith("### ")) {
    return <h3 className="mt-8 text-lg font-semibold">{renderInline(block.slice(4))}</h3>;
  }
  if (block.startsWith("## ")) {
    return <h2 className="mt-12 text-2xl font-semibold">{renderInline(block.slice(3))}</h2>;
  }
  if (block.startsWith("- ")) {
    const items = block
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
    return (
      <ul className="mt-4 list-disc space-y-2 pl-5 text-brand-fg-muted">
        {items.map((it, j) => (
          <li key={j}>{renderInline(it)}</li>
        ))}
      </ul>
    );
  }
  return (
    <p key={key} className="mt-4 leading-relaxed text-brand-fg-muted">
      {renderInline(block)}
    </p>
  );
}

/**
 * Scheme allowlist for markdown link hrefs. Content is operator-authored
 * today, but a raw href would render `javascript:` / `data:` if any field ever
 * becomes user-influenced (pentest L6). Allows http(s)/mailto/tel + relative
 * links; everything else collapses to "#".
 */
function safeHref(href: string): string {
  const trimmed = href.trim();
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!m) return trimmed; // relative URL or fragment — safe
  const scheme = m[1].toLowerCase();
  return scheme === "http" ||
    scheme === "https" ||
    scheme === "mailto" ||
    scheme === "tel"
    ? trimmed
    : "#";
}

function renderInline(text: string): ReactNode {
  // Order matters: links first, then bold.
  const linkSplit = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return linkSplit.map((piece, i) => {
    const linkMatch = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={safeHref(linkMatch[2])}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-brand-primary"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <Fragment key={i}>{renderBoldInline(piece)}</Fragment>;
  });
}

function renderBoldInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
