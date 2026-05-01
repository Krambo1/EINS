/**
 * Shared Tailwind preset for all EINS apps.
 * Consumed by apps/portal/tailwind.config.ts via `presets: [...]`.
 *
 * Does NOT include a `content` array — each app must provide its own
 * so purging works correctly.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        md: "2.5rem",
        lg: "3rem",
      },
      screens: { "2xl": "1320px" },
    },
    extend: {
      colors: {
        "bg-primary": "var(--bg-primary)",
        "bg-secondary": "var(--bg-secondary)",
        "bg-tertiary": "var(--bg-tertiary)",
        "fg-primary": "var(--fg-primary)",
        "fg-secondary": "var(--fg-secondary)",
        "fg-tertiary": "var(--fg-tertiary)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          pressed: "var(--accent-pressed)",
          glow: "var(--accent-glow)",
          soft: "var(--accent-soft)",
        },
        border: "var(--border)",
        "border-hover": "var(--border-hover)",
        tone: {
          good: "var(--tone-good)",
          warn: "var(--tone-warn)",
          bad: "var(--tone-bad)",
          neutral: "var(--tone-neutral)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.015em",
        tighter: "-0.01em",
      },
      transitionTimingFunction: {
        expo: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 300ms cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-up": "accordion-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 200ms ease-out",
      },
      minHeight: {
        tap: "var(--tap-min)",
      },
      spacing: {
        tap: "var(--tap-min)",
      },
    },
  },
  plugins: [],
};
