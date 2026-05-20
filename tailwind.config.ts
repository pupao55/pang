import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // A-share convention: red = up, green = down (opposite of US markets)
        bull: "#dc2626",
        bear: "#16a34a",
        neutral: "#6b7280",
        // Light-mode layout tokens (v1.9 — was dark-mode in v1.0-v1.8)
        surface: "#f6f7f9",       // page background
        "surface-2": "#f3f4f6",   // table headers, subtle bands
        panel: "#ffffff",          // card surface
        border: "#e5e7eb",         // subtle dividers
        ink: "#111827",            // primary text
        muted: "#6b7280",          // secondary text
        subtle: "#9ca3af",         // tertiary text
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontVariantNumeric: {
        tabular: "tabular-nums",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)",
      },
    },
  },
  plugins: [],
};

export default config;
