import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Parchment / vellum tones — warm yellow-cream that reads as
        // 17th-century printed page rather than modern AI-tool white.
        // Adjusted from generic #FAFAF7 to something with actual aged
        // character.
        parchment: {
          DEFAULT: "#F4ECDC",
          light: "#F9F3E5",
          dim: "#EADFC6",
          line: "#D9C9A6",
          rule: "#B6A37C",
        },
        // Ink — deep warm brown-black, not pure ink. Reads as
        // nib-and-iron-gall on paper.
        ink: {
          DEFAULT: "#1A1310",
          subtle: "#2E251F",
          muted: "#5A4A3D",
          mute: "#7A685A",
          ghost: "#A89784",
        },
        // Oxblood / burgundy — the council's seal color. Reserved for
        // primary CTA, the highlighted Solo card border, verdict
        // emphasis. Sparing use, 5–8% surface coverage.
        oxblood: {
          50: "#F5E5E7",
          100: "#E9C9CD",
          200: "#D49097",
          300: "#B45661",
          400: "#8E2C39",
          500: "#751B27",
          600: "#5C111C",
          700: "#4B0E17",
          800: "#3D0C12",
          900: "#2A080D",
        },
        // Gold leaf — metallic accent. Used for hover underlines,
        // section-mark dots, decorative rules. Olive-warm gold, not
        // shiny.
        gold: {
          DEFAULT: "#9B7A30",
          subtle: "#C7A554",
          dim: "#D9BD75",
          line: "#7B5F23",
        },
        // Used sparingly for risk/reject affordances.
        flag: {
          DEFAULT: "#A85410",
          subtle: "#F0E1C8",
        },
      },
      fontFamily: {
        // Display — Bodoni Moda. High-contrast didone with sharp serifs
        // + dramatic stroke modulation. Reads as classical broadsheet
        // headline at 4–7rem; clamps gracefully thanks to optical-size axis.
        display: ["var(--font-display)", "Bodoni Moda", "Didot", "Times New Roman", "serif"],
        // Body — Crimson Pro. Modulated old-style serif designed for
        // long reading on screen. Pairs with Bodoni's high-contrast
        // display without competing.
        sans: ["var(--font-serif-body)", "Crimson Pro", "Crimson Text", "Georgia", "serif"],
        // Italic emphasis — Newsreader Italic. Rounder, slightly less
        // formal than Crimson — used as voice shifts in pulled quotes.
        italic: ["var(--font-italic)", "Newsreader", "Georgia", "serif"],
        // Mono — JetBrains Mono. Kept for cli + numerics. Some
        // judicial UIs use Courier as concession to mechanical
        // typewriter; JBM reads cleaner on display and the council
        // metaphor is digital-modern, not 1950s-archive.
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },
      letterSpacing: {
        tightx: "-0.014em",
        tightxx: "-0.022em",
        widetracked: "0.18em",
      },
      maxWidth: {
        prose: "62ch",
        page: "1180px",
      },
      boxShadow: {
        // Hairline plate edge — feels like an aged paper insert on
        // the page rather than a modal popup.
        plate: "0 0 0 1px #D9C9A6, 0 1px 2px rgba(40,30,20,0.05)",
        plateHi: "0 0 0 2px #5C111C, 0 16px 32px -18px rgba(60,15,20,0.22)",
        ring: "0 0 0 2px #F4ECDC, 0 0 0 4px #5C111C",
        // Wax-seal style emboss for the highlight pricing card.
        seal: "inset 0 0 0 1px #C7A554, 0 0 0 2px #5C111C, 0 22px 40px -22px rgba(60,15,20,0.30)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        sealPulse: {
          "0%, 100%": { transform: "rotate(-2deg) scale(1)" },
          "50%": { transform: "rotate(-2deg) scale(1.04)" },
        },
      },
      animation: {
        rise: "rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
        sealPulse: "sealPulse 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
