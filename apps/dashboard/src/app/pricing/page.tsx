"use client";

/**
 * /pricing — G6-1 (docs/simsa-gap-backlog-2026-07-18.md, Bae 2026-07-19 확정 구조).
 *
 * 티어: Free $0 / 단건 협의체 $1/회(구 $3 패스 대체) / Solo $19/월 / Pro $49/월.
 * 결제는 아직 비활성 — 유료 버튼은 기존 /billing/checkout을 호출하고, 서버가
 * billing_not_configured(503)을 주면 "아직 결제가 열리지 않았어요"를 정직하게
 * 보여준다(조용한 대체 금지). LS 상품+variant env가 설정되는 순간(2단계, 별도
 * 승인) 이 페이지는 코드 변경 없이 실결제로 이어진다.
 */
import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { getUserKey } from "@/lib/workflow-store";

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

type Product = "council-single" | "solo-monthly" | "pro-monthly";

export default function PricingPage() {
  const { t } = useI18n();
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const buy = async (product: Product) => {
    if (pendingProduct) return;
    setPendingProduct(product);
    setNotice(null);
    try {
      const resp = await fetch(`${CENTRAL_PLANE_URL}/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, userKey: getUserKey() }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.status === 503) {
        setNotice(t.pricing.notOpenYet);
        return;
      }
      if (!resp.ok) {
        setNotice(t.pricing.checkoutFailed);
        return;
      }
      const b = (await resp.json()) as { url?: string };
      if (b.url) window.location.href = b.url;
      else setNotice(t.pricing.checkoutFailed);
    } catch {
      setNotice(t.pricing.checkoutFailed);
    } finally {
      setPendingProduct(null);
    }
  };

  const P = t.pricing;
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{P.title}</h1>
      <p className="mt-1 text-sm text-gray-500">{P.subtitle}</p>
      <div className="callout mt-4 border-brand-200 bg-brand-50 text-brand-800">{P.betaNotice}</div>
      {notice && <div className="callout mt-3 border-amber-200 bg-amber-50 text-amber-800">{notice}</div>}

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Free */}
        <TierCard name={P.freeName} price="$0" period={P.freePeriod} highlight={false}
          features={[P.freeF1, P.freeF2, P.freeF3, P.freeF4]}
          cta={<Link href="/projects/new" className="btn btn-md btn-primary w-full text-center">{P.freeCta}</Link>}
        />
        {/* 단건 협의체 — $1/회 */}
        <TierCard name={P.singleName} price="$1" period={P.singlePeriod} highlight={false}
          features={[P.singleF1, P.singleF2, P.singleF3]}
          cta={<BuyButton label={P.buyCta} loading={pendingProduct === "council-single"} onClick={() => buy("council-single")} />}
        />
        {/* Solo */}
        <TierCard name={P.soloName} price="$19" period={P.monthPeriod} highlight
          features={[P.soloF1, P.soloF2, P.soloF3, P.soloF4]}
          cta={<BuyButton label={P.subscribeCta} loading={pendingProduct === "solo-monthly"} onClick={() => buy("solo-monthly")} />}
        />
        {/* Pro */}
        <TierCard name={P.proName} price="$49" period={P.monthPeriod} highlight={false}
          features={[P.proF1, P.proF2, P.proF3, P.proF4]}
          cta={<BuyButton label={P.subscribeCta} loading={pendingProduct === "pro-monthly"} onClick={() => buy("pro-monthly")} />}
        />
      </div>

      <p className="mt-6 text-xs text-gray-400">
        {P.finePrint}{" "}
        <Link href="/legal/refunds" className="text-brand-700 hover:underline">{P.refundLink}</Link>
      </p>
    </main>
  );
}

function TierCard({ name, price, period, features, cta, highlight }: {
  name: string; price: string; period: string; features: string[];
  cta: React.ReactNode; highlight: boolean;
}) {
  return (
    <div className={`card flex flex-col p-6 ${highlight ? "border-brand-400 ring-1 ring-brand-200" : ""}`}>
      <p className="text-sm font-semibold text-gray-900">{name}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">{price}</p>
      <p className="mt-0.5 text-xs text-gray-500">{period}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-600">
        {features.map((f, i) => (
          <li key={i} className="flex gap-2"><span className="text-brand-500">✓</span><span>{f}</span></li>
        ))}
      </ul>
      <div className="mt-5">{cta}</div>
    </div>
  );
}

function BuyButton({ label, loading, onClick }: { label: string; loading: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={loading} className="btn btn-md btn-secondary w-full disabled:opacity-50">
      {loading ? "…" : label}
    </button>
  );
}
