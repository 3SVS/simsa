# 자동수리(auto_fix) 실제 코드수정 실증 — 2026-07-19

메모리에서 수 주째 "계정 게이트로 미실증"이던 자동수리 라운드트립을, 배 님 GitHub
연결(P0 CORS 500 핫픽스 #413 이후) 후 처음 끝까지 실증했다.

## 실증 경로

1. **P0 선결**: GitHub 연결이 CORS 회귀(#413, Response.redirect의 immutable 헤더 vs
   corsMiddleware)로 500이라 막혀 있었음 → 수정 후 배 님 연결 완료(@seunghunbae-3svs).
2. **1차(apply-walmart, 실제 작동 앱)**: 검수 UAR → repair → **brief_only**(지시서 PR).
   판정이 "시작 버튼 못 찾음"이라는 모호한 UX라 워커가 고칠 코드를 특정 못 함.
3. **2차(simsa-autofix-test, 명확 결함)**: 추가 버튼이 push만 하고 render/저장 누락.
   - private repo → clone 403(Write access not granted). **auto_fix 엔진 문제 아님 —
     토큰 public_repo scope가 private repo 접근 불가.** → public 전환.
   - public 후 재트리거 → **mode=auto_fix, changedFiles=1, non-draft PR #1.**

## 워커가 실제로 넣은 수정 (simsa-autofix-test#1)

```diff
-    // ⛔ 버그: render()와 localStorage.setItem을 호출하지 않아 아무 일도 안 일어난다.
+    localStorage.setItem("memos", JSON.stringify(memos));
+    render();
+    document.getElementById("memo").value = "";
```

심어둔 결함(렌더/저장 누락)을 정확히 진단·수정. **"지시서만 넘긴다"가 아니라 실제
코드 자동수정이 된다.**

## 결론 — auto_fix 성공 조건 (실측)

| 조건 | 결과 |
|---|---|
| 접근 가능 repo (public 또는 토큰 write) | 필수 — private면 clone 403 |
| 검수가 결함을 잡음 (repairable: works≠true + agentPrompt) | 필수 |
| 명확·국소 코드 결함 | 실제 auto_fix 성공 (render/저장 누락 → 정확 수정) |
| 모호한 UX 판정 (예: "시작 버튼 못 찾음") | brief_only 폴백(지시서) |

외부 평가(2026-07-19)의 "자동수정은 아직 프롬프트 핸드오프"는 **조건부로만 맞다**:
private/모호 케이스는 폴백, 명확결함+접근가능 repo면 실제 코드 수정. 남은 성숙
과제 = 모호한 판정에서의 진단력(워커 프롬프트) + private repo 지원(scope 확대 안내).

준비물: `C:\Users\seung\.conclave\simsa-autofix-test\`(결함 메모장 + 배포 런북).
