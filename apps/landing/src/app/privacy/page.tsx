import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "../../components/Logo";

export const metadata: Metadata = {
  title: "Privacy Policy · Conclave AI",
  description:
    "How Conclave AI handles your repository metadata, PR diffs, API keys, and account data. BYO mode never routes code through our servers.",
};

export default function PrivacyPage() {
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
        <p className="numeral text-3xl mb-4">Privacy</p>
        <h1 className="font-display font-medium text-5xl leading-[1.05] tracking-tightxx mb-3">
          What we keep, what we don&rsquo;t.
        </h1>
        <p className="text-ink-mute text-sm font-mono tracking-wider">
          Effective 2026-10-04
        </p>

        <div className="mt-12 space-y-10 leading-relaxed text-[17px]">
          <section>
            <h2 className="font-display text-2xl font-medium mb-3">Who we are</h2>
            <p>
              Conclave AI is operated by <strong>3SVS Co.</strong> (brand:
              3Stripe), headquartered in Seoul, Republic of Korea. We provide an
              AI code review service that runs as a GitHub App and a CLI. Reach
              the maintainer at{" "}
              <a className="link-anim text-oxblood" href="mailto:hi@conclave-ai.dev">
                hi@conclave-ai.dev
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">Data we collect</h2>
            <ul className="list-disc list-inside space-y-2 marker:text-oxblood">
              <li>
                <strong>Repository metadata</strong> &mdash; owner, repo name,
                PR number, head SHA, branch name. Used to address the review
                back to the right pull request.
              </li>
              <li>
                <strong>PR diff content</strong> &mdash; the lines changed in
                the pull request. Sent to the LLM provider you (or we, on
                managed plans) configured. Not retained beyond the review run.
              </li>
              <li>
                <strong>Council outcomes</strong> &mdash; per-agent verdicts,
                blocker counts, cost, latency, episodic memory ids. Stored to
                make the self-evolving substrate work.
              </li>
              <li>
                <strong>User identity</strong> &mdash; GitHub login, email,
                tier, and a hashed device-flow token. No password is ever
                stored.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              Data we don&rsquo;t collect
            </h2>
            <ul className="list-disc list-inside space-y-2 marker:text-oxblood">
              <li>Source code outside the changed lines of an open PR.</li>
              <li>The contents of files not referenced by the review.</li>
              <li>
                Your API keys&rsquo; actual values. In BYO mode they never
                reach our servers &mdash; they live on your CI runner.
              </li>
              <li>
                Commit messages, repository names, or user identities in
                federated sync. Only{" "}
                <code className="font-mono text-sm bg-parchment-light px-1.5 py-0.5 rounded">
                  {`{kind, domain, category, severity, normalized tags, day bucket, sha256}`}
                </code>{" "}
                leaves the machine.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">Where data goes</h2>
            <p className="mb-3">
              Different categories travel to different processors. We list
              each; nothing else is brokered.
            </p>
            <ul className="list-disc list-inside space-y-2 marker:text-oxblood">
              <li>
                <strong>Anthropic, OpenAI, Google</strong> &mdash; the LLM
                providers powering the council. PR diff content + your PRD (if
                provided) is sent to the providers whose keys are configured.
              </li>
              <li>
                <strong>Cloudflare D1</strong> &mdash; our database (council
                outcomes, account data). Data residency follows
                Cloudflare&rsquo;s policy.
              </li>
              <li>
                <strong>Resend</strong> &mdash; transactional email (welcome,
                payment receipts). Email address only.
              </li>
              <li>
                <strong>Lemon Squeezy</strong> &mdash; Merchant of Record for
                paid tiers. Payment details never touch our servers; Lemon
                Squeezy handles card data and VAT (KR / US / EU).
              </li>
              <li>
                <strong>Vercel</strong> &mdash; landing page hosting. Standard
                request logs (IP, user agent) retained for 30 days.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              BYO mode is special
            </h2>
            <p>
              When you provide your own API keys (Anthropic / OpenAI / Google),
              the LLM call goes directly from your CI runner or local machine
              to the provider.{" "}
              <strong>
                Your code does not touch our servers in this path.
              </strong>{" "}
              We only receive the resulting verdict and the metadata listed
              above. This is the recommended mode for teams uncomfortable
              routing source code through any third party.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">Retention</h2>
            <ul className="list-disc list-inside space-y-2 marker:text-oxblood">
              <li>
                <strong>Episodic memory</strong> &mdash; 90-day TTL, then
                auto-deleted.
              </li>
              <li>
                <strong>Answer-keys / failure-catalog</strong> &mdash; retained
                indefinitely. These are anonymized success / failure patterns;
                no raw code or PII.
              </li>
              <li>
                <strong>Federated sync</strong> &mdash; sha256 hashes plus
                normalized tags. Permanent.
              </li>
              <li>
                <strong>Account data</strong> &mdash; retained until you
                request deletion.
              </li>
              <li>
                <strong>Vercel request logs</strong> &mdash; 30 days.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">Your rights</h2>
            <p>
              You can request access, export, or deletion of your account data
              at any time by emailing{" "}
              <a
                className="link-anim text-oxblood"
                href="mailto:hi@conclave-ai.dev"
              >
                hi@conclave-ai.dev
              </a>
              . Deletion is usually completed within 7 business days. We honor
              GDPR (EU), CCPA (California), and the Republic of Korea&rsquo;s
              개인정보 보호법.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">
              Changes to this policy
            </h2>
            <p>
              We&rsquo;ll post material changes on this page and update the
              effective date at the top. Account holders are notified by email
              of any change that materially expands the data we collect.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-medium mb-3">Contact</h2>
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
