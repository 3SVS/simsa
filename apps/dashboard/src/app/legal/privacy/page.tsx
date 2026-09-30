/**
 * G9 — 개인정보처리방침 (KO 정본).
 * 실제 데이터 흐름을 정확히 기술한다 — 여기 적힌 것과 코드가 다르면 그건 버그다:
 * userKey 익명 키 / 이메일·GitHub 선택 / LLM 3벤더 전송 / episodic 90일 GC /
 * 삭제 미러 / 공유 스냅샷 / 클라이언트 오류(쿼리 제거).
 * Train W — W-9: §1 운영 정보(비식별) 문단은 lib/privacy-ops-info.mjs에서 온다 — 그 항목과
 * 0069 컬럼·봉투 필드의 대응은 test/privacy-ops-info.test.mjs가 고정한다. 시행일도 그 모듈의
 * 상수 하나(PRIVACY_EFFECTIVE_DATE)다.
 */
import {
  PRIVACY_EFFECTIVE_DATE,
  OPS_INFO_TITLE,
  OPS_INFO_LEAD,
  OPS_INFO_ITEMS,
  OPS_INFO_PURPOSE,
  OPS_INFO_BASIS,
  OPS_INFO_RETENTION,
  OPS_INFO_OPT_OUT,
  TRAINING_COPY_NOTE,
  TRAINING_DATA_TITLE,
  TRAINING_DATA_SCOPE,
  TRAINING_DATA_PURPOSE,
  TRAINING_DATA_BASIS,
  TRAINING_DATA_CHOICE,
  RATE_LIMIT_RETENTION_NOTE,
  PRIVACY_CHANGE_LOG,
} from "@/lib/privacy-ops-info.mjs";

export const metadata = { title: "개인정보처리방침 — Simsa" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Simsa 개인정보처리방침</h1>
      <p className="text-xs text-gray-400">시행일: {PRIVACY_EFFECTIVE_DATE} (베타) · The Korean text is authoritative.</p>

      <h2>1. 수집하는 정보</h2>
      <ul>
        <li><strong>익명 사용자 키</strong> — 계정 없이 프로젝트를 구분하기 위한 무작위 키. 브라우저에 저장됩니다.</li>
        <li><strong>프로젝트 데이터</strong> — 입력한 아이디어·답변·제품 설명서·검수 결과·스크린샷 등 서비스 이용 과정에서 생성되는 내용.</li>
        <li><strong>이메일 주소(선택)</strong> — 알림·복귀 안내를 위해 직접 등록한 경우에만. 로그에는 마스킹되어 기록됩니다.</li>
        <li><strong>GitHub 계정 정보(선택)</strong> — GitHub 연결 시 저장소 접근에 필요한 최소 정보.</li>
        <li><strong>오류·사용 기록</strong> — 서비스 개선을 위한 브라우저 오류(메시지·경로 — 주소의 검색어/토큰 부분은 저장 전에 제거)와 기능 사용 이벤트. 입력 폼의 내용은 오류 수집에 포함하지 않습니다.</li>
        <li><strong>{OPS_INFO_TITLE}</strong> — 아래 문단에 따로 적었습니다.</li>
      </ul>

      {/* Train K: 확인 결과 화면의 운영 정보 한 줄 '자세히'가 여기(#ops-info)로 온다. */}
      <p id="ops-info" className="mt-4 scroll-mt-16 font-semibold text-gray-900">{OPS_INFO_TITLE}</p>
      <p>{OPS_INFO_LEAD}</p>
      <ul>
        {OPS_INFO_ITEMS.map((item) => (
          <li key={item.label}>
            <strong>{item.label}</strong> — {item.detail}
          </li>
        ))}
      </ul>
      <ul>
        <li><strong>목적</strong> — {OPS_INFO_PURPOSE}</li>
        <li><strong>근거</strong> — {OPS_INFO_BASIS}</li>
        <li><strong>보유 기간</strong> — {OPS_INFO_RETENTION}</li>
        <li><strong>기록 끄기</strong> — {OPS_INFO_OPT_OUT}</li>
      </ul>

      <h2>2. AI 처리 위탁 (중요)</h2>
      <p>
        문서 생성·검수 판단을 위해 입력하신 내용(아이디어, 스펙, 검수 대상 화면의 텍스트, 붙여넣은
        에러 메시지 등)이 다음 AI 처리자에게 전송됩니다: <strong>Anthropic, OpenAI, Google</strong>.
        전송은 처리 목적에 한정되며, 학습 데이터 제공은 별도의 명시적 동의(opt-in) 없이는 이루어지지
        않습니다.
      </p>

      {/* Train K: 확인 결과 화면 학습 데이터 카드의 '자세히'가 여기(#training-data)로 온다. */}
      <p id="training-data" className="mt-4 scroll-mt-16 font-semibold text-gray-900">{TRAINING_DATA_TITLE}</p>
      <ul>
        <li><strong>담기는 것</strong> — {TRAINING_DATA_SCOPE}</li>
        <li><strong>목적</strong> — {TRAINING_DATA_PURPOSE}</li>
        <li><strong>근거</strong> — {TRAINING_DATA_BASIS}</li>
        <li><strong>선택</strong> — {TRAINING_DATA_CHOICE}</li>
        <li><strong>철회와 삭제</strong> — {TRAINING_COPY_NOTE}</li>
      </ul>

      <h2>3. 보관과 파기</h2>
      <ul>
        <li>프로젝트 데이터는 삭제하실 때까지 보관됩니다. 프로젝트 삭제 시 서버 데이터(기록·스크린샷 저장소 포함)도 함께 삭제됩니다. {TRAINING_COPY_NOTE}</li>
        <li>임시 작업 기록(에피소드 로그)은 90일 후 자동 삭제됩니다.</li>
        <li>{RATE_LIMIT_RETENTION_NOTE}</li>
        <li>공유 링크의 스냅샷은 회수하실 때까지 보관되며, 회수 시 열람이 차단됩니다.</li>
      </ul>

      <h2>4. 저장 위치와 인프라</h2>
      <p>
        데이터는 Cloudflare(데이터베이스·저장소·서버)와 Vercel(웹 호스팅) 인프라에 저장·처리됩니다.
        이메일 발송에는 Resend를 사용합니다.
      </p>

      <h2>5. 제3자 제공</h2>
      <p>
        법령에 따른 경우를 제외하고, 위 처리 위탁(2·4항) 외에 개인정보를 제3자에게 제공하지 않습니다.
        결제 기능 도입 시 결제 대행사가 추가되며 사전 고지합니다.
      </p>

      <h2>6. 이용자의 권리</h2>
      <ul>
        <li>프로젝트와 그 데이터는 언제든 직접 삭제할 수 있습니다.</li>
        <li>이메일 알림은 설정에서 해제할 수 있고, 복귀 안내 메일은 프로젝트당 최대 1회만 발송됩니다.</li>
        <li>학습 데이터 제공 동의는 각 프로젝트의 설정 화면에서 철회할 수 있으며, 철회하시면 색인된 학습 데이터 사본을 지웁니다(2항).</li>
        <li>운영 정보 기록은 각 프로젝트의 설정 화면이나 확인 결과 화면에서 끌 수 있습니다(1항).</li>
      </ul>

      <h2>7. 개인정보 보호책임자</h2>
      <ul>
        <li>개인정보 보호책임자: 배승훈 (대표자, 오마이워크)</li>
        <li>문의: seunghunbae@3svs.com</li>
      </ul>

      <h2>변경 이력</h2>
      <ul>
        {PRIVACY_CHANGE_LOG.map((entry) => (
          <li key={`${entry.date}-${entry.summary}`}>
            <strong>{entry.date}</strong> — {entry.summary}
          </li>
        ))}
      </ul>
    </>
  );
}
