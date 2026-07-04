import type { Metadata } from "next";
import "./globals.css";

// Static metadata is single-language; KO leads because the open-beta community
// distribution is Korean-first (link previews on Threads/KakaoTalk). The page
// itself detects browser language and offers a manual EN/KO toggle.
export const metadata: Metadata = {
  title: "Simsa — AI로 만든 앱, 제대로 작동하는지 확인하세요",
  description:
    "AI로 만든 결과물이 요청한 대로 됐는지 근거와 함께 확인하세요. 오픈 베타 — 베타 기간 무료. Built an app with AI? Make sure it actually works.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
