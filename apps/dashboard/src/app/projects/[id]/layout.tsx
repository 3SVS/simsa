import { StepNextButton } from "@/components/StepNextButton";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  // Navigation lives in the app-wide slim sidebar (AppSidebar). Here we just give the
  // page content generous, centered breathing room — AI-platform style.
  //
  // ★"다음 한 걸음" 바는 여기 **한 번만** 단다 (2026-09-01). 종전엔 화면마다 손으로
  //  붙였고, 그래서 15개 중 4개에만 붙어 있었다 — 하필 검수·결과·고칠 것이 전부
  //  빠져 순환의 어느 지점에도 다음 안내가 없었다. 배선을 기억에 맡기면 빠진다.
  //  다음이 없는 화면에서는 이 컴포넌트가 스스로 아무것도 렌더하지 않는다.
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      {children}
      <StepNextButton />
    </div>
  );
}
