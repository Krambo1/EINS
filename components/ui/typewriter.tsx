"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

type Phase = "typing" | "holding" | "deleting" | "empty";

interface TypewriterProps {
  words: string[];
  typeSpeed?: number;
  deleteSpeed?: number;
  holdDuration?: number;
  emptyDuration?: number;
  className?: string;
}

export function Typewriter({
  words,
  typeSpeed = 90,
  deleteSpeed = 45,
  holdDuration = 1600,
  emptyDuration = 250,
  className = "",
}: TypewriterProps) {
  const prefersReduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");

  useEffect(() => {
    if (prefersReduced) return;
    const word = words[index];

    // Natural-feel easing for typing: slow at start, faster in the middle,
    // slow near the end. Gives the word a "breath".
    const typingDelay = (nextLen: number, total: number) => {
      const p = (nextLen - 1) / Math.max(total - 1, 1); // 0..1 position in word
      // 1 - sin(π·p) peaks at edges (value 1), dips in middle (value 0).
      const curve = 1 - Math.sin(Math.PI * p); // 0..1
      // Map curve to a multiplier roughly 0.6x..1.55x.
      const mult = 0.6 + curve * 0.95;
      // Small random jitter so it doesn't feel clockwork (~±10%).
      const jitter = 0.9 + Math.random() * 0.2;
      // Extra emphasis on punctuation chars — they land with a beat.
      const ch = word[nextLen - 1];
      const punct = /[,.!?;:]/.test(ch) ? 2.2 : 1;
      return typeSpeed * mult * jitter * punct;
    };

    // Deleting accelerates from slow to fast as the word vanishes (ease-in).
    const deletingDelay = (nextLen: number, total: number) => {
      const p = nextLen / Math.max(total, 1); // 0..1 remaining portion
      const mult = 0.55 + p * 0.9; // fuller word = slower, shrinking = faster
      const jitter = 0.92 + Math.random() * 0.16;
      return deleteSpeed * mult * jitter;
    };

    if (phase === "typing") {
      if (text.length < word.length) {
        const t = setTimeout(() => {
          setText(word.slice(0, text.length + 1));
        }, typingDelay(text.length + 1, word.length));
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("holding"), 0);
      return () => clearTimeout(t);
    }

    if (phase === "holding") {
      const t = setTimeout(() => setPhase("deleting"), holdDuration);
      return () => clearTimeout(t);
    }

    if (phase === "deleting") {
      if (text.length > 0) {
        const t = setTimeout(() => {
          setText(word.slice(0, text.length - 1));
        }, deletingDelay(text.length, word.length));
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("empty"), 0);
      return () => clearTimeout(t);
    }

    if (phase === "empty") {
      const t = setTimeout(() => {
        setIndex((i) => (i + 1) % words.length);
        setPhase("typing");
      }, emptyDuration);
      return () => clearTimeout(t);
    }
  }, [text, phase, index, words, typeSpeed, deleteSpeed, holdDuration, emptyDuration, prefersReduced]);

  // Find the longest word so we can reserve space for it.
  // This keeps preceding text (e.g. "Mehr") from shifting when the word changes.
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  if (prefersReduced) {
    return (
      <span style={{ display: "inline-block", position: "relative" }}>
        <span aria-hidden style={{ visibility: "hidden", paddingRight: "0.15em" }}>
          {longest}
        </span>
        <span
          className={className}
          style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", whiteSpace: "nowrap" }}
        >
          {words[0]}
        </span>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-block", position: "relative" }}>
      {/* Invisible sizer — reserves width of the longest word (plus cursor space)
          so "Mehr" stays put and the block stays visually balanced. */}
      <span aria-hidden style={{ visibility: "hidden", paddingRight: "0.15em" }}>
        {longest}
      </span>
      {/* Actual typewriter content, overlaid on top. */}
      <span
        className={className}
        style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", whiteSpace: "nowrap" }}
      >
        {text}
        <span
          aria-hidden
          className="ml-[0.05em] inline-block h-[0.85em] w-[0.08em] -translate-y-[0.02em] bg-current align-middle"
          style={{ animation: "typewriter-blink 1s steps(2) infinite" }}
        />
      </span>
      <style jsx>{`
        @keyframes typewriter-blink {
          0%, 50% { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
      `}</style>
    </span>
  );
}
