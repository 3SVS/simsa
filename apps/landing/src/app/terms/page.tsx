import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "../../components/Logo";

export const metadata: Metadata = {
  title: "Terms of Service · Conclave AI",
  description:
    "Terms governing your use of Conclave AI &mdash; FSL-1.1-Apache-2.0 license, BYO-free pricing, and the deliberation contract.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="border-b border-parchment-line">
        <div className="mx-auto max-w-page px-6 py-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={22} />
          </Link>
          <Link
            href="/"
            className="font-mono text-[11px] uppercase tracking-widetracked text-ink-mute hover:text-ink link-anim"
          >
            ← Return to council
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="numeral text-3xl mb-4">Terms</p>
        <h1 className="font-display font-medium text-5xl leading-[1.05] tracking-tightxx mb-3">
          The deliberation contract.
        </h1>
        <p className="text-ink-mute text-sm font-mono tracking-wider">
          Effective 2026-10-04
        </p>

        <div className="mt-12 space-y-10 leading-relaxed text-[17px]">
          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              I. The service
            </h2>
            <p>
              Conclave AI is a multi-agent code review service. It runs as a
              GitHub App (<code className="font-mono text-sm bg-parchment-light px-1.5 py-0.5 rounded">conclave-ai-code-council</code>)
              and a CLI (<code className="font-mono text-sm bg-parchment-light px-1.5 py-0.5 rounded">@simsa/cli</code>).
              It reviews pull requests, optionally writes patches via an
              autofix loop, and learns from accepted / rejected outcomes. By
              installing the App or running the CLI, you agree to these terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">II. License</h2>
            <p>
              The Conclave AI source is published under the{" "}
              <strong>
                Functional Source License, Version 1.1, Apache 2.0 Future
                License (FSL-1.1-Apache-2.0)
              </strong>
              . In plain terms: you may read, fork, modify, and self-host the
              code for any purpose other than offering a competing managed
              service. Two years after each release date, that release
              automatically re-licenses to Apache-2.0 for all uses, including
              commercial. The complete FSL text lives in the repository&rsquo;s{" "}
              <code className="font-mono text-sm bg-parchment-light px-1.5 py-0.5 rounded">
                LICENSE
              </code>{" "}
              file.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              III. Your responsibilities
            </h2>
            <ul className="list-disc list-inside space-y-2 marker:text-oxblood">
              <li>
                Use the service only on repositories you own or have
                authorization to manage.
              </li>
              <li>
                Don&rsquo;t use the service to generate, host, or evaluate code
                intended for unauthorized intrusion, fraud, or illegal activity.
              </li>
              <li>
                Don&rsquo;t abuse the API or attempt to bypass rate limits.
              </li>
              <li>
                In BYO mode, you are responsible for your own LLM-provider
                billing and key security.
              </li>
              <li>
                You must be at least 14 years old to use the service, or have
                guardian consent, under the Republic of Korea&rsquo;s Civil
                Code.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              IV. Service availability
            </h2>
            <p>
              We operate the service on Cloudflare Workers + Containers. During
              the open beta there is no formal SLA. We aim for best-effort
              availability but won&rsquo;t claim uptime numbers we can&rsquo;t
              guarantee. Service may be modified or discontinued with 30
              days&rsquo; notice to account holders.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              V. Pricing &amp; payments
            </h2>
            <p className="mb-3">
              <strong>BYO mode is free forever.</strong> You bring your own API
              keys; you pay your LLM provider directly. We charge nothing.
            </p>
            <p>
              Paid tiers (First-PR pass, Solo, Pro) are processed by{" "}
              <strong>Lemon Squeezy</strong> as Merchant of Record. Lemon
              Squeezy handles VAT (KR / US / EU), card storage, and chargebacks.
              Billing is in USD. Refunds within 30 days of purchase are
              available if you have not used more than 50% of the included
              reviews &mdash; email{" "}
              <a
                className="link-anim text-oxblood"
                href="mailto:hi@conclave-ai.dev"
              >
                hi@conclave-ai.dev
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              VI. Data &amp; model training
            </h2>
            <p className="mb-3">
              We do not train on your code by default. Reviews are processed to
              produce a result and are not retained for model training unless
              you explicitly opt in.
            </p>
            {/* Train K (#573 검증 9): same facts as the Simsa privacy policy §2
                (dashboard lib/privacy-ops-info.mjs TRAINING_DATA_SCOPE ·
                TRAINING_COPY_NOTE) and the setting's current name — pinned by
                apps/dashboard/test/train-k-consent.test.mjs. */}
            <p className="mb-3">
              <strong>Opt-in (off by default).</strong> Only if you choose
              &ldquo;Allow&rdquo; under &ldquo;Share training data
              (optional)&rdquo; (in Korean, &ldquo;학습 데이터 제공(선택)&rdquo;)
              &mdash; asked on a completed check result and changeable in each
              project&rsquo;s Settings &mdash; then, when you check changes to
              code you connected, we keep a copy of the product description,
              checklist, result, code changes, the repository name, the change
              request number, the code version ID and a record of the steps,
              together with operating info from that time: build tool, app
              type, entry, source, screen and input language, number of
              projects, plan and AI usage (amount processed and model), plus
              your country code if operating info recording is on. Checks of an
              app by its web address are not included. We use these copies to
              improve checks and fixes, including training our own models.
            </p>
            <p className="mb-3">
              Before storing, we remove values that look like secret keys (API
              keys, tokens, <code className="font-mono text-sm">.env</code>{" "}
              values). Copies have no account-email field, but they do include
              the repository name (which can contain your account name) and
              anything you wrote in your descriptions or code. Instead of your
              user key itself, copies carry a transformed value of it, which we
              can still link to your other records. Aggregated insights (for
              example, common failure patterns across tools) may be published;
              individual data, code, or projects are never sold or handed to
              anyone else.
            </p>
            <p className="mb-3">
              You can withdraw at any time with one click, on a check result or
              in a project&rsquo;s Settings. When you withdraw or delete the
              project, we stop keeping new copies and delete the indexed saved
              copies (deletion starts right away and failed deletions are
              retried). Some copies saved before deletion was available may not
              be removed automatically &mdash; contact us and we will delete
              what we can find.
            </p>
            <p>
              <strong>BYO (CLI) mode.</strong> Your code and diffs stay on your
              machine and are never sent to us for training. Only the anonymous
              failure-pattern counts described in our federated-sync docs leave
              your machine, and only if you enable sync.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">VII. Outputs</h2>
            <p>
              The council&rsquo;s verdicts, patches, and summaries are
              algorithmically generated. They are advisory. You retain full
              control over what code lands in your repository &mdash; final
              merge decisions are yours (or your delegated CI). We do not
              warrant that the council finds every defect or that the patches
              it writes are bug-free. Treat them as a high-quality second
              opinion, not a replacement for human judgment.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              VIII. Limitation of liability
            </h2>
            <p>
              To the maximum extent permitted by law, our aggregate liability
              under these terms is limited to the fees you paid us in the
              twelve months preceding the claim. For BYO users who pay
              nothing, that amount is zero. We are not liable for indirect,
              incidental, consequential, or punitive damages, including lost
              profits, lost data, or business interruption.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              IX. Termination
            </h2>
            <p>
              You can stop using the service at any time by uninstalling the
              GitHub App and revoking your CLI token via{" "}
              <code className="font-mono text-sm bg-parchment-light px-1.5 py-0.5 rounded">
                conclave logout
              </code>
              . We may suspend access for abuse, illegal use, or non-payment of
              paid tiers, with notice when reasonable.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              X. Governing law
            </h2>
            <p>
              These terms are governed by the laws of the Republic of Korea.
              Disputes are subject to the exclusive jurisdiction of the Seoul
              Central District Court, unless you are a consumer in another
              jurisdiction with mandatory local consumer protections, in which
              case those protections apply.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">XI. Contact</h2>
            <p>
              3SVS Co. (brand: 3Stripe) &middot; Seoul, Republic of Korea
              &middot;{" "}
              <a
                className="link-anim text-oxblood"
                href="mailto:hi@conclave-ai.dev"
              >
                hi@conclave-ai.dev
              </a>
            </p>
          </section>

          <p className="italic text-ink-mute text-center mt-12">
            Habemus consensum.
          </p>
        </div>
      </main>

      <footer className="border-t border-parchment-line mt-20">
        <div className="mx-auto max-w-page px-6 py-6 flex items-center justify-between text-xs text-ink-mute">
          <span className="italic">
            © {new Date().getFullYear()} 3SVS &middot; Sealed in Seoul.
          </span>
          <span className="font-mono tracking-wider">conclave-ai.dev</span>
        </div>
      </footer>
    </div>
  );
}
