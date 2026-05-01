import * as React from "react";
import { Card, CardContent, Badge } from "@eins/ui";

interface Props {
  id: string;
  title: string;
  description?: string;
  count: number;
  tone?: "neutral" | "good" | "warn" | "bad";
  children: React.ReactNode;
  emptyMessage?: string;
}

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm scroll-mt-28";

export function QueueShell({
  id,
  title,
  description,
  count,
  tone = "neutral",
  children,
  emptyMessage,
}: Props) {
  return (
    <Card id={id} className={GLOW_CARD}>
      <CardContent className="space-y-4 pt-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-fg-secondary">{description}</p>
            )}
          </div>
          <Badge tone={count > 0 ? tone : "good"}>
            {count > 0 ? count : "0"}
          </Badge>
        </header>
        {count === 0 && emptyMessage ? (
          <p className="rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-4 py-3 text-sm text-tone-good">
            {emptyMessage}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
