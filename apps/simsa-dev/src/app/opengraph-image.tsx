import { ImageResponse } from "next/og";

// Shared Simsa OG card (seal + wordmark + tagline), rendered by next/og. Used for
// KakaoTalk/Threads link previews (KO-first channels). The KO tagline renders only
// when the Pretendard font loads — otherwise we fall back to the English line so a
// missing font can never ship tofu (□) or break the build.

export const runtime = "edge";
export const alt = "Simsa — the checking layer for AI-built apps";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SEAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="9" fill="#8e2c39"/><g stroke="#faf6ee" fill="none" stroke-width="5" stroke-linecap="square"><path d="M17 8 V16 M12 16 H22 M12 16 V27 M22 16 V27"/><path d="M28 8 V27"/><path d="M12 35 H28 V55 M12 35 V55 M12 55 H28"/><path d="M41 8 V21 M36 21 H46 M36 21 V41 M46 21 V41 M36 41 V55 M46 41 V55"/><path d="M53 8 V55 M53 29 H57"/></g></svg>`;
const SEAL_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(SEAL_SVG)}`;

export default async function OpengraphImage() {
  let koFont: ArrayBuffer | null = null;
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/public/static/Pretendard-SemiBold.otf",
    );
    if (res.ok) koFont = await res.arrayBuffer();
  } catch {
    koFont = null;
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#faf8f3",
          padding: "0 96px",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width="128" height="128" src={SEAL_DATA_URI} alt="" />
        <div style={{ marginTop: 40, fontSize: 96, fontWeight: 700, color: "#18181b", letterSpacing: "-0.02em" }}>
          Simsa
        </div>
        {koFont ? (
          <div style={{ marginTop: 10, fontSize: 42, color: "#52525b", fontFamily: "Pretendard" }}>
            AI로 만든 앱을 위한 확인 레이어
          </div>
        ) : null}
        <div style={{ marginTop: koFont ? 4 : 14, fontSize: 30, fontWeight: 600, color: "#8e2c39" }}>
          The checking layer for AI-built apps
        </div>
      </div>
    ),
    {
      ...size,
      ...(koFont ? { fonts: [{ name: "Pretendard", data: koFont, weight: 600, style: "normal" }] } : {}),
    },
  );
}
