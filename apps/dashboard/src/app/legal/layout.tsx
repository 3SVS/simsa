/**
 * /legal/* — G9 법적 문서 공통 레이아웃 (docs/simsa-gap-backlog-2026-07-18.md).
 * 본문은 KO 정본(법적 문서는 단일 언어 정본이 안전); EN은 상단 한 줄 안내.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <article className="legal-doc text-sm leading-relaxed text-gray-700 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-gray-900 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-gray-900 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1">
        {children}
      </article>
    </main>
  );
}
