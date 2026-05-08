import type { Metadata } from "next";
import { Bodoni_Moda, Crimson_Pro, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const SITE_URL = "https://conclave-ai.dev";

// Judicial-conclave typography stack:
//   - Bodoni Moda: high-contrast didone display. Aggressive at large
//     sizes, classical at small. Optical-size axis makes h1 and
//     section heads share the same family.
//   - Crimson Pro: modulated old-style serif body. Designed for
//     long-form reading; carries the editorial-broadsheet metaphor.
//   - Newsreader Italic: secondary italic voice — used for pulled
//     quotes and emphasis where Crimson italic would be too uniform.
//   - JetBrains Mono: kept for cli, version markers, numerics.
const fontDisplay = Bodoni_Moda({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "700", "800", "900"],
});

const fontBody = Crimson_Pro({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif-body",
  weight: ["300", "400", "500", "600", "700"],
});

const fontItalic = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-italic",
  style: ["italic"],
  weight: ["400", "500", "600"],
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Conclave AI — multi-agent code review for your PRs",
  description:
    "A council of AI agents reviews every PR against your PRD. Verdict and dissent on every commit.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Conclave AI",
    description:
      "A council of AI agents reviews every PR against your PRD. Verdict and dissent on every commit.",
    type: "website",
    url: SITE_URL,
    siteName: "Conclave AI",
  },
  twitter: {
    card: "summary",
    title: "Conclave AI",
    description:
      "A council of AI agents reviews every PR against your PRD.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontItalic.variable} ${fontMono.variable}`}
    >
      <body className="antialiased font-sans bg-parchment text-ink">{children}</body>
    </html>
  );
}
