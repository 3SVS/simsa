/**
 * Conclave AI — landing page MVP.
 *
 * Tone: Linear/Vercel-flavored "serious dev tool". No marketing fluff,
 * no hype animations. Honest copy: "council of agents reviews against
 * your PRD; catches what single-LLM review misses."
 *
 * Sections (top → bottom):
 *   1. Top bar — wordmark + sign-in CTA
 *   2. Hero — pitch + 1 install line + screencast placeholder
 *   3. How it works — 3 steps
 *   4. Why a council (not just Claude alone) — moat data
 *   5. Pricing — Free BYO / Solo $19 / Pro $49
 *   6. FAQ — 4 questions
 *   7. Footer — github + login + email
 *
 * Structure prioritizes "what does this do?" → "how do I get it?"
 * → "what's the pricing?" → trust signals. No carousel, no testimonials
 * (we don't have any yet — fabricating those is the worst kind of lie).
 */
import { Logo, LogoIcon, Wordmark as WordmarkComponent } from "../components/Logo";
import { DemoForm } from "../components/DemoForm";

const CLI_ENDPOINT = process.env.NEXT_PUBLIC_API_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";
const SITE_URL = "https://conclave-ai.dev";

// Primary onboarding: GitHub App install URL. Clicking sends users to
// GitHub's repo-picker; on completion the install webhook auto-registers
// the saas_users row and PR events thereafter trigger reviews
// automatically. No CLI, no token, no key management required.
const LOGIN_URL = "https://github.com/apps/conclave-ai-code-council/installations/new";

export default function Home() {
  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-5xl px-6">
        <Hero />
        <HowItWorks />
        <TrustedBy />
        <CouncilEvidence />
        <DemoForm />
        <Pricing />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}

// --- Top bar ----------------------------------------------------------------

function TopBar() {
  return (
    <header className="border-b border-neutral-200 bg-white/70 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center group">
          <Logo size={22} className="group-hover:opacity-80 transition-opacity" />
        </a>
        <nav className="flex items-center gap-6 text-sm text-neutral-700">
          <a href="#how" className="hover:text-accent-900">How</a>
          <a href="#try" className="hover:text-accent-900">Try it</a>
          <a href="#pricing" className="hover:text-accent-900">Pricing</a>
          <a href="#faq" className="hover:text-accent-900">FAQ</a>
          <a
            href="https://github.com/seunghunbae-3svs/conclave-ai"
            className="hover:text-accent-900"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

// --- Hero -------------------------------------------------------------------

function Hero() {
  return (
    <section className="bg-grid -mx-6 px-6 py-24 border-b border-neutral-200">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-sm text-accent-700 mb-6">
          v0.16 · code review SaaS · multi-agent + PRD-aware
        </p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-neutral-900 leading-[1.05]">
          A council of AI agents reviews your PRs<br />
          <span className="text-accent-900">against your PRD.</span>
        </h1>
        <p className="mt-6 text-lg text-neutral-600 max-w-prose leading-relaxed">
          Three frontier models — Claude, GPT-5, and Gemini — independently review every
          pull request. Disagreement surfaces blockers no single model catches alone. When
          you attach a PRD, agents flag spec-mismatches as first-class blockers — not just
          code-quality issues.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2 max-w-2xl">
          <InstallCommand />
          <SignInButton />
        </div>

        <p className="mt-6 text-sm text-neutral-500">
          Open beta · 1 free review on install · BYO Anthropic key = unlimited free · Solo $19/mo
        </p>
      </div>
    </section>
  );
}

function InstallCommand() {
  return (
    <div className="rounded-md border border-neutral-300 bg-neutral-900 text-neutral-100 font-mono text-sm">
      <div className="px-4 py-2 border-b border-neutral-700 text-neutral-400 text-xs uppercase tracking-wider">
        install
      </div>
      <pre className="px-4 py-3 overflow-x-auto">
        <span className="text-accent-300">$</span> npm i -g @conclave-ai/cli
      </pre>
    </div>
  );
}

function SignInButton() {
  return (
    <a
      href={LOGIN_URL}
      className="rounded-md bg-accent-900 hover:bg-accent-700 transition-colors text-white px-5 py-3 flex items-center justify-center gap-2 font-medium"
    >
      <span>Connect GitHub — install the App</span>
      <span aria-hidden="true">→</span>
    </a>
  );
}

// --- How it works -----------------------------------------------------------

function HowItWorks() {
  const steps: Array<{ n: string; title: string; body: string }> = [
    {
      n: "01",
      title: "Install the GitHub App",
      body:
        "One click. The Conclave AI Code Council app subscribes to your repo's pull-request events. Nothing runs in CI; the work happens in our sandbox.",
    },
    {
      n: "02",
      title: "Drop a PRD into your repo",
      body:
        "Add .conclave/prd.md describing what the PR is supposed to do — acceptance criteria, out-of-scope, non-functional requirements. Agents read it and flag mismatches.",
    },
    {
      n: "03",
      title: "Open a PR — get a verdict",
      body:
        "Three agents independently review. Disagreements escalate. Verdict + blockers land as a PR check + Telegram message. If verdict is rework, the worker agent autofixes and pushes back automatically.",
    },
  ];
  return (
    <section id="how" className="py-24 border-b border-neutral-200">
      <h2 className="text-3xl font-bold text-neutral-900 mb-2">How it works</h2>
      <p className="text-neutral-500 mb-12">Three steps. No CI changes. No keys to manage on your end (unless you want to).</p>
      <div className="grid gap-8 md:grid-cols-3">
        {steps.map((s) => (
          <article key={s.n} className="border border-neutral-200 rounded-lg p-6 bg-white">
            <p className="font-mono text-xs text-accent-700 mb-3">{s.n}</p>
            <h3 className="font-semibold text-neutral-900 mb-2">{s.title}</h3>
            <p className="text-sm text-neutral-600 leading-relaxed">{s.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// --- Trusted by -------------------------------------------------------------

function TrustedBy() {
  const logos = [
    { name: "eventbadge", caption: "Live on production since 2026-04" },
    { name: "golf-now", caption: "Beta integration, 2026-05" },
    { name: "applywalmart", caption: "Pilot, 2026-04" },
  ];
  return (
    <section className="py-16 border-b border-neutral-200">
      <p className="text-xs uppercase tracking-wider text-neutral-500 mb-6 text-center">
        Used in production by
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        {logos.map((l) => (
          <article key={l.name} className="text-center">
            <p className="font-mono text-sm font-medium text-neutral-700">{l.name}</p>
            <p className="text-xs text-neutral-500 mt-1">{l.caption}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// --- Council evidence -------------------------------------------------------

function CouncilEvidence() {
  return (
    <section className="py-24 border-b border-neutral-200">
      <h2 className="text-3xl font-bold text-neutral-900 mb-2">Why a council, not Claude alone</h2>
      <p className="text-neutral-500 mb-12 max-w-prose">
        From our own dogfood (2026-05-06, 15 synthetic-bug PRs across 5 vibe-coder Next.js
        templates). Honest numbers; no marketing math.
      </p>
      <div className="grid gap-6 md:grid-cols-3">
        <Stat label="Catch rate" value="100%" sub="conclave 3-agent council, vs 100% Claude alone — both catch obvious bugs" />
        <Stat label="Blockers per PR" value="10.93" sub="vs 3.80 Claude alone — 3× deeper findings, including issues lost on a single model" />
        <Stat label="Spec-mismatch flags" value="9.0/PR" sub="(Claude alone + PRD): blocker categories that no plain code review surfaces" />
      </div>
      <p className="mt-12 text-sm text-neutral-500 max-w-prose leading-relaxed">
        The moat isn't "smarter than Claude" — it's <span className="font-medium text-neutral-700">multi-agent
        depth + PRD-aware spec compliance</span>. Three models reading your PR and PRD together catch
        scope creep, route mismatches, and forgotten acceptance criteria that one model alone misses.
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <article className="border border-neutral-200 rounded-lg p-6 bg-white">
      <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">{label}</p>
      <p className="text-3xl font-bold text-accent-900 mb-3 font-mono">{value}</p>
      <p className="text-sm text-neutral-600 leading-relaxed">{sub}</p>
    </article>
  );
}

// --- Pricing ----------------------------------------------------------------

function Pricing() {
  return (
    <section id="pricing" className="py-24 border-b border-neutral-200">
      <h2 className="text-3xl font-bold text-neutral-900 mb-2">Pricing</h2>
      <p className="text-neutral-500 mb-12 max-w-prose">
        Hard cutoffs, no overage bills. Booster top-ups instead of surprise invoices.
      </p>
      <div className="grid gap-6 md:grid-cols-3">
        <PriceCard
          tier="Free (BYO key)"
          price="$0"
          sub="bring your own Anthropic API key"
          features={[
            "Unlimited reviews",
            "Unlimited autofix",
            "Anonymous failure-pattern sharing",
            "All council features",
          ]}
          cta="Sign in with GitHub"
          ctaHref={LOGIN_URL}
        />
        <PriceCard
          tier="Solo"
          price="$19"
          sub="per month"
          highlight
          features={[
            "30 reviews / month",
            "10 autofix cycles / month",
            "Council + PRD layer",
            "Telegram + PR comment delivery",
            "$5 booster: +5 reviews",
          ]}
          cta="Start with Solo"
          ctaHref={LOGIN_URL}
        />
        <PriceCard
          tier="Pro"
          price="$49"
          sub="per month"
          features={[
            "80 reviews / month",
            "30 autofix cycles / month",
            "Priority sandbox queue",
            "Private mode (no data sharing)",
            "$5 booster",
          ]}
          cta="Start with Pro"
          ctaHref={LOGIN_URL}
        />
      </div>
      <p className="mt-8 text-xs text-neutral-500 max-w-prose">
        Trial tier (5 reviews / 2 autofix per month, platform-managed key) available without a card while we run open beta.
        Stripe metering ships once moat data accumulates from real usage.
      </p>
    </section>
  );
}

function PriceCard({
  tier,
  price,
  sub,
  features,
  cta,
  ctaHref,
  highlight = false,
}: {
  tier: string;
  price: string;
  sub: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlight?: boolean;
}) {
  return (
    <article
      className={`rounded-lg p-6 border ${
        highlight
          ? "border-accent-700 bg-accent-50 ring-1 ring-accent-700"
          : "border-neutral-200 bg-white"
      }`}
    >
      <p className="text-sm font-semibold text-neutral-900">{tier}</p>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-accent-900 font-mono">{price}</span>
        <span className="text-sm text-neutral-500">{sub}</span>
      </p>
      <ul className="mt-6 space-y-2 text-sm text-neutral-700">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-accent-700">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        className={`mt-6 block text-center rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          highlight
            ? "bg-accent-900 text-white hover:bg-accent-700"
            : "border border-neutral-300 text-neutral-900 hover:bg-neutral-50"
        }`}
      >
        {cta}
      </a>
    </article>
  );
}

// --- FAQ --------------------------------------------------------------------

function FAQ() {
  const items: Array<{ q: string; a: string }> = [
    {
      q: "How is this different from Claude Code or Cursor?",
      a:
        "Those are IDE assistants. Conclave AI runs at the PR layer with three independent agents and reads your PRD. Different layer, different value: catches what single-agent review misses + flags spec deviations no plain code review can produce.",
    },
    {
      q: "What does Conclave AI see from my repo?",
      a:
        "Only the diff and the files referenced in blockers — same as a human reviewer would. Code never leaves our sandbox. Federated learning shares only anonymized signals (kind/category/severity hash, day-bucket, sha256). See docs/federated-sync.md.",
    },
    {
      q: "Do I have to install anything in CI?",
      a:
        "No. The GitHub App receives webhooks; review and autofix run in our Cloudflare Containers sandbox. Your CI stays untouched.",
    },
    {
      q: "Can I bring my own Anthropic key?",
      a:
        "Yes — the free tier is BYO-key with unlimited usage. You opt into anonymous failure-pattern sharing in exchange. The trade is honest: we get data to make the federated catalog smarter; you get unlimited free reviews.",
    },
  ];
  return (
    <section id="faq" className="py-24">
      <h2 className="text-3xl font-bold text-neutral-900 mb-12">FAQ</h2>
      <div className="space-y-6">
        {items.map((item) => (
          <article key={item.q}>
            <h3 className="font-semibold text-neutral-900 mb-2">{item.q}</h3>
            <p className="text-sm text-neutral-600 leading-relaxed max-w-prose">{item.a}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// --- Footer -----------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-neutral-200 mt-12 py-12">
      <div className="mx-auto max-w-5xl px-6 grid gap-8 md:grid-cols-3 text-sm text-neutral-600">
        <div>
          <Logo size={20} />
          <p className="mt-3 text-xs text-neutral-500 max-w-xs">
            Multi-agent code review against your PRD. Open beta on Cloudflare.
          </p>
        </div>
        <nav className="space-y-2">
          <p className="font-semibold text-neutral-900">Product</p>
          <a href="#how" className="block hover:text-accent-900">How it works</a>
          <a href="#pricing" className="block hover:text-accent-900">Pricing</a>
          <a href="#faq" className="block hover:text-accent-900">FAQ</a>
        </nav>
        <nav className="space-y-2">
          <p className="font-semibold text-neutral-900">Resources</p>
          <a
            href="https://github.com/seunghunbae-3svs/conclave-ai"
            className="block hover:text-accent-900"
            target="_blank"
            rel="noreferrer"
          >
            GitHub repo
          </a>
          <a
            href="https://github.com/apps/conclave-ai-code-council"
            className="block hover:text-accent-900"
            target="_blank"
            rel="noreferrer"
          >
            Install GitHub App
          </a>
          <a href="mailto:hi@conclave-ai.dev" className="block hover:text-accent-900">Contact</a>
        </nav>
      </div>
      <p className="mx-auto max-w-5xl px-6 mt-10 text-xs text-neutral-400">
        © {new Date().getFullYear()} 3SVS. All rights reserved.
      </p>
    </footer>
  );
}
