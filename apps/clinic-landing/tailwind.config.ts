import type { Config } from "tailwindcss";

/**
 * Multi-tenant Tailwind config. All brand-specific colors/fonts are wired through
 * CSS custom properties injected per-clinic by `app/[clinicSlug]/layout.tsx`.
 * No hard-coded EINS brand tokens here — this is a white-label template.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        md: "2rem",
        lg: "2.5rem",
      },
      screens: { "2xl": "1200px" },
    },
    extend: {
      colors: {
        "brand-primary": "var(--brand-primary)",
        "brand-primary-soft": "var(--brand-primary-soft)",
        "brand-accent": "var(--brand-accent)",
        "brand-bg": "var(--brand-bg)",
        "brand-bg-soft": "var(--brand-bg-soft)",
        "brand-fg": "var(--brand-fg)",
        "brand-fg-muted": "var(--brand-fg-muted)",
        "brand-border": "var(--brand-border)",
      },
      fontFamily: {
        brand: ["var(--brand-font)", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: {
        brand: "var(--brand-radius)",
        "brand-sm": "calc(var(--brand-radius) * 0.5)",
        "brand-lg": "calc(var(--brand-radius) * 1.5)",
        "brand-pill": "9999px",
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
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-up": "accordion-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 400ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
