import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simsa for Developers",
  description:
    "Developer docs for Simsa — review, compare, and accept AI-built software with evidence.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Pretendard variable — Korean-first typography (dynamic subset, cached CDN). */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
