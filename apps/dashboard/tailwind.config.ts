import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

/**
 * Conclave brand tokens — matched to the brand site (conclave-ai-theta):
 * a classical "papal conclave" palette of deep oxblood, antique gold, and warm
 * parchment neutrals (not the earlier green).
 *
 * - `gray` → `stone` (warm neutral, not cool zinc) for a parchment feel.
 * - `indigo` (legacy primary/link class app-wide) → deep oxblood `brand`, so every
 *   screen recolors without per-file churn. `gold` is the secondary accent.
 * - status colors carry meaning only; `decision` stays a calm slate (info).
 */
const oxblood = {
  50: "#faf2f2",
  100: "#f3dfe1",
  200: "#e6bdc1",
  300: "#d4929a",
  400: "#b85f6a",
  500: "#8e2c39",
  600: "#5c111c",
  700: "#4b0e17",
  800: "#3a0b12",
  900: "#2b080d",
  950: "#180406",
};

const gold = {
  50: "#faf6ea",
  100: "#f3e9c9",
  200: "#e7d29a",
  300: "#d9b86a",
  400: "#c7a554",
  500: "#a9883b",
  600: "#9b7a30",
  700: "#7a5f28",
  800: "#5f4a22",
  900: "#4a3a1e",
};

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Apple SD Gothic Neo",
          "Pretendard",
          "sans-serif",
        ],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        gray: colors.stone,
        indigo: oxblood,
        brand: oxblood,
        gold,
        passed: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
        failed: { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
        inconclusive: { bg: "#fffbeb", text: "#b45309", border: "#fde68a" },
        decision: { bg: "#f8fafc", text: "#475569", border: "#e2e8f0" },
      },
      borderColor: {
        DEFAULT: colors.stone[200],
      },
    },
  },
  plugins: [],
};

export default config;
