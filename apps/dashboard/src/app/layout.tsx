import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ToastProvider } from "@/components/Toast";
import { AppSidebar } from "@/components/AppSidebar";
import { GlobalDropZone } from "@/components/GlobalDropZone";
import { LanguageToggle } from "@/components/LanguageToggle";
import { BRAND } from "@/lib/brand.mjs";

// A distinctive grotesk (not Inter/system) is the single biggest signal that a UI
// was designed, not AI-defaulted. Geist Sans for text, Geist Mono for code/identifiers.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: BRAND.metadataTitle,
  description: BRAND.metadataDescription,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-[#faf8f3] text-gray-900 antialiased">
        <I18nProvider>
          <ToastProvider>
            <GlobalDropZone />
            {/* App shell: slim left sidebar (like an AI-platform workspace) + spacious main */}
            <div className="flex min-h-screen">
              <AppSidebar />
              <main className="relative min-w-0 flex-1 pt-12 md:pt-0">
                <div className="absolute right-4 top-3 z-20">
                  <LanguageToggle />
                </div>
                {children}
              </main>
            </div>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
