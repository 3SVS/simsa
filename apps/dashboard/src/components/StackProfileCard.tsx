"use client";

/**
 * StackProfileCard — 프로젝트 설정에서 "어디에 올렸나 / 어디에 저장하나"를 고친다.
 *
 * ## 왜 (AF-1, 설계 D-7)
 *
 * 이 두 질문은 새 프로젝트 첫 화면에만 있었다. 제출물-우선 진입으로 첫 화면이 칸
 * 하나가 되면서 질문이 갈 곳이 필요해졌다 — **삭제가 아니라 이동**이기 때문이다.
 * 여기가 그 거처이고, 첫 화면과 달리 **언제든 다시 고칠 수 있다**(종전엔 프로젝트를
 * 만들 때 한 번 답하면 바꿀 방법이 없었다 — 그 자체가 결함이었다).
 *
 * 바로 아래 서비스·배포 안내(ServiceMcpSetup)가 이 값을 소비하므로, 고치는 자리와
 * 효과가 보이는 자리가 붙어 있다.
 *
 * 답은 **선택**이다. 비우면 안내가 중립을 유지한다(스택 불가지: 미응답=중립).
 */
import { useState } from "react";
import { StackProfileRows } from "@/components/StackProfileRows";
import { stackProfilePatch } from "@/lib/stack-profile.mjs";
import { saveExtendedProjectData, type ExtendedProjectData } from "@/lib/workflow-store";
import { useI18n } from "@/i18n/I18nProvider";

/** 저장소가 실제로 담는 모양을 그대로 쓴다 — service-catalog의 느슨한 타입을
 *  쓰면 id가 옵셔널이라 저장 경로와 어긋난다. */
type StoredStackProfile = NonNullable<ExtendedProjectData["stackProfile"]>;

export function StackProfileCard({
  projectId,
  initial,
  onChange,
}: {
  projectId: string;
  initial?: StoredStackProfile | null;
  /** 저장 직후 부모가 안내를 다시 그릴 수 있게 알린다. */
  onChange?: (next: StoredStackProfile | undefined) => void;
}) {
  const { t } = useI18n();
  const [hostingId, setHostingId] = useState<string | null>(initial?.hosting?.id ?? null);
  const [hostingOther, setHostingOther] = useState(initial?.hosting?.other ?? "");
  const [dataId, setDataId] = useState<string | null>(initial?.data?.id ?? null);
  const [dataOther, setDataOther] = useState(initial?.data?.other ?? "");
  const [saved, setSaved] = useState(false);

  function persist(next: {
    hostingId: string | null;
    hostingOther: string;
    dataId: string | null;
    dataOther: string;
  }) {
    const patch = stackProfilePatch(next.hostingId, next.hostingOther, next.dataId, next.dataOther) as {
      stackProfile?: StoredStackProfile;
    };
    // 두 축을 모두 비우면 patch가 {}라 종전 값이 남는다 — 지운 것도 저장으로 셈해야
    // "잘못 골랐다"를 되돌릴 수 있으므로 명시적으로 undefined를 쓴다.
    saveExtendedProjectData(projectId, { stackProfile: patch.stackProfile });
    setSaved(true);
    onChange?.(patch.stackProfile);
  }

  const bind = {
    hostingId,
    hostingOther,
    dataId,
    dataOther,
    setHostingId: (v: string | null) => {
      setHostingId(v);
      persist({ hostingId: v, hostingOther, dataId, dataOther });
    },
    setHostingOther: (v: string) => {
      setHostingOther(v);
      persist({ hostingId, hostingOther: v, dataId, dataOther });
    },
    setDataId: (v: string | null) => {
      setDataId(v);
      persist({ hostingId, hostingOther, dataId: v, dataOther });
    },
    setDataOther: (v: string) => {
      setDataOther(v);
      persist({ hostingId, hostingOther, dataId, dataOther: v });
    },
  };

  return (
    <div className="card p-5">
      <h3 className="section-title">{t.stackCard.title}</h3>
      <p className="section-desc">{t.stackCard.desc}</p>
      <div className="mt-3">
        <StackProfileRows t={t} {...bind} />
      </div>
      {saved && <p className="mt-3 text-xs text-gray-400">{t.stackCard.saved}</p>}
    </div>
  );
}
