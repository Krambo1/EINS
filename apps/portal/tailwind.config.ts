import type { Config } from "tailwindcss";
import sharedPreset from "@eins/ui/tailwind-preset";

const config: Config = {
  presets: [sharedPreset],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
