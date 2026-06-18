import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AppSidebar } from "@/components/AppSidebar";

// A distinctive grotesk (not Inter/system) is the single biggest signal that a UI
// was designed, not AI-defaulted. Geist Sans for text, Geist Mono for code/identifiers.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Conclave — Acceptance workspace for AI-built software",
  description:
    "Turn product intent into acceptance checks, review history, and fix instructions for AI-built software.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-[#faf8f3] text-gray-900 antialiased">
        <I18nProvider>
          {/* App shell: slim left sidebar (like an AI-platform workspace) + spacious main */}
          <div className="flex min-h-screen">
            <AppSidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
