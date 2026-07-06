// Branded 404 — app-router not-found. Static, bilingual (KO leads), one primary
// action back home (Nielsen H3). Reuses the landing's parchment + .cta pill.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없어요 · Page not found — Simsa",
  description: "요청한 페이지를 찾을 수 없습니다. Page not found.",
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "3rem 1.5rem",
        gap: "1.25rem",
      }}
    >
      {/* Simsa seal mark */}
      <svg
        width="52"
        height="52"
        viewBox="0 0 64 64"
        aria-hidden="true"
        style={{ filter: "drop-shadow(0 8px 18px rgba(75, 14, 23, 0.24))" }}
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
        <h1
          style={{
            margin: "0 0 0.4rem",
            fontSize: "1.5rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--fg)",
            wordBreak: "keep-all",
          }}
        >
          이 페이지를 찾을 수 없어요
        </h1>
        <p style={{ margin: 0, fontSize: "1rem", color: "var(--muted)" }}>
          Page not found
        </p>
      </div>

      <Link className="cta" href="/">
        돌아가기 · Go home
      </Link>
    </main>
  );
}
