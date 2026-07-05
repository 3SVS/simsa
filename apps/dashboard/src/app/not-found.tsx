// Branded 404 — app-router not-found. Static bilingual copy (no useI18n: keeps
// the page safe if it renders outside providers) + one primary action back to
// the projects workspace (Nielsen H3). Matches the dashboard .btn primitives.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "찾을 수 없는 페이지예요 · Page not found — Simsa",
  description: "요청한 페이지를 찾을 수 없습니다. Page not found.",
};

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      {/* Simsa seal mark */}
      <svg
        width="52"
        height="52"
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="drop-shadow-[0_8px_18px_rgba(75,14,23,0.24)]"
      >
        <rect x="2" y="2" width="60" height="60" rx="9" fill="#8e2c39" />
        <g stroke="#faf6ee" fill="none" strokeWidth="5" strokeLinecap="square">
          <path d="M17 8 V16 M12 16 H22 M12 16 V27 M22 16 V27" />
          <path d="M28 8 V27" />
          <path d="M12 35 H28 V55 M12 35 V55 M12 55 H28" />
          <path d="M41 8 V21 M36 21 H46 M36 21 V41 M46 21 V41 M36 41 V55 M46 41 V55" />
          <path d="M53 8 V55 M53 29 H57" />
        </g>
      </svg>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          찾을 수 없는 페이지예요
        </h1>
        <p className="mt-1 text-sm text-gray-500">Page not found</p>
      </div>

      <Link href="/projects" className="btn btn-primary btn-md">
        돌아가기 · Go home
      </Link>
    </main>
  );
}
