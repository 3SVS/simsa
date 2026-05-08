/**
 * Conclave AI — landing page (editorial dev-tool refresh).
 *
 * Aesthetic direction: Linear/Vercel polish + light editorial weight.
 * - Bricolage Grotesque for display (distinctive 90s grotesque).
 * - Geist Sans for body (Vercel-aligned, technical, warm).
 * - JetBrains Mono for cli/labels/numerics.
 * - Newsreader Italic for sparing editorial emphasis.
 * - Single deep ink-blue accent (#0A2540) — Stripe-grade, not generic
 *   purple gradient.
 * - Cream paper bg with subtle SVG noise grain (globals.css).
 * - Editorial section markers (01 / 02 / 03 / …) in monospace.
 *
 * Sections (top → bottom):
 *   1. Top bar
 *   2. Hero
 *   3. How it works (01)
 *   4. Council evidence (02)
 *   5. Try-it-now demo (03) — DemoForm component (unchanged)
 *   6. Pricing (04)
 *   7. FAQ (05)
 *   8. Footer
 */
import { Logo } from "../components/Logo";
import { DemoForm } from "../components/DemoForm";

const SITE_URL = "https://conclave-ai.dev";

// Primary onboarding: GitHub App install URL. Clicking sends users to
// GitHub's repo-picker; installation:created webhook auto-registers
// the saas_users row and PR events thereafter trigger reviews
// automatically. No CLI, no token, no key management required.
const LOGIN_URL = "https://github.com/apps/conclave-ai-code-council/installations/new";

export default function Home() {
  return (
    <>
      <TopBar />
      <main>
        <Hero />
        <HowItWorks />
        <CouncilEvidence />
        <DemoSection />
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
    <header className="sticky top-0 z-50 border-b border-paper-line bg-paper/85 backdrop-blur-sm">
      <div className="mx-auto max-w-page px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 group">
          <Logo size={22} className="group-hover:opacity-80 transition-opacity" />
        </a>
        <nav className="flex items-center gap-7 text-sm text-ink-subtle">
          <a href="#how" className="link-anim hover:text-ink">How</a>
          <a href="#try" className="link-anim hover:text-ink">Try it</a>
          <a href="#pricing" className="link-anim hover:text-ink">Pricing</a>
          <a href="#faq" className="link-anim hover:text-ink">FAQ</a>
          <a
            href="https://github.com/seunghunbae-3svs/conclave-ai"
            className="link-anim hover:text-ink hidden sm:inline"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a
            href={LOGIN_URL}
            className="rounded-md bg-accent-900 hover:bg-accent-700 transition-colors text-paper px-3.5 py-1.5 text-xs font-medium tracking-wide"
          >
            Install →
          </a>
        </nav>
      </div>
    </header>
  );
}

// --- Hero -------------------------------------------------------------------

function Hero() {
  return (
    <section className="bg-grid border-b border-paper-line">
      <div className="mx-auto max-w-page px-6 pt-24 pb-28 md:pt-32 md:pb-36">
        <div className="grid gap-x-12 md:grid-cols-12 items-start">
          {/* Asymmetric column layout — heading + body span 8, CTAs span 4. */}
          <div className="md:col-span-8 animate-rise">
            <div className="flex items-center gap-3 mb-7">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
                v0.16 · 2026
              </span>
              <span className="h-px flex-1 bg-paper-line" />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
                code review SaaS
              </span>
            </div>
            <h1 className="font-display font-bold text-[clamp(2.5rem,6vw,4.75rem)] leading-[1.02] tracking-tightxx text-ink">
              A council of AI agents
              <br />
              reviews your PRs
              <br />
              <span className="font-serif italic font-medium text-accent-900">against your PRD.</span>
            </h1>
            <p className="mt-7 text-lg md:text-xl text-ink-subtle max-w-prose leading-[1.55]">
              Three frontier models — Claude, GPT-5, and Gemini — independently review every
              pull request. Disagreement surfaces blockers no single model catches alone. When
              you attach a PRD, agents flag spec-mismatches as first-class blockers — not just
              code-quality.
            </p>
          </div>

          <div className="md:col-span-4 mt-10 md:mt-0 animate-rise" style={{ animationDelay: "120ms" }}>
            <SignInButton />
            <InstallCommand />
            <p className="mt-5 text-xs text-ink-mute leading-relaxed">
              Open beta · 1 free review on install · BYO Anthropic key = unlimited free · Solo $19/mo
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignInButton() {
  return (
    <a
      href={LOGIN_URL}
      className="block rounded-md bg-accent-900 hover:bg-accent-700 transition-colors text-paper px-5 py-3.5 text-center font-medium tracking-tight shadow-plate"
    >
      <span>Connect GitHub</span>
      <span aria-hidden="true" className="ml-2 inline-block transition-transform group-hover:translate-x-1">→</span>
      <span className="block mt-1 text-[11px] font-normal text-paper/70 font-mono tracking-wider uppercase">
        installs the app
      </span>
    </a>
  );
}

function InstallCommand() {
  return (
    <div className="mt-3 rounded-md border border-paper-line bg-ink text-paper font-mono text-[13px] overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10">
        <span className="h-2 w-2 rounded-full bg-paper/30" />
        <span className="h-2 w-2 rounded-full bg-paper/30" />
        <span className="h-2 w-2 rounded-full bg-paper/30" />
        <span className="ml-2 text-[10px] tracking-[0.18em] uppercase text-paper/50">
          power-user cli
        </span>
      </div>
      <pre className="px-4 py-3 leading-relaxed">
        <span className="text-accent-300">$</span>{" "}
        <span className="text-paper">npm i -g @conclave-ai/cli</span>
      </pre>
    </div>
  );
}

// --- How it works -----------------------------------------------------------

function HowItWorks() {
  const steps = [
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
        "Three agents independently review. Disagreements escalate. Verdict + blockers land as a PR check. Solo and Pro tiers also push the verdict to Telegram.",
    },
  ];
  return (
    <section id="how" className="border-b border-paper-line">
      <div className="mx-auto max-w-page px-6 py-28">
        <SectionHeader mark="01 — workflow" title="How it works" />
        <p className="mt-3 max-w-prose text-ink-muted">
          Three steps. No CI changes. No keys to manage on your end (unless you want to).
        </p>
        <ol className="mt-14 grid gap-px md:grid-cols-3 bg-paper-line border-y border-paper-line">
          {steps.map((s, i) => (
            <li
              key={s.n}
              className="bg-paper px-7 py-9 group hover:bg-paper-dim transition-colors"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute mb-5">
                {s.n}
              </p>
              <h3 className="font-display text-2xl font-semibold text-ink leading-snug tracking-tightx mb-3">
                {s.title}
              </h3>
              <p className="text-[15px] text-ink-muted leading-[1.65]">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// --- Council evidence -------------------------------------------------------

function CouncilEvidence() {
  return (
    <section className="border-b border-paper-line bg-paper-dim/40">
      <div className="mx-auto max-w-page px-6 py-28">
        <SectionHeader mark="02 — moat data" title={<>Why a council, <span className="font-serif italic font-medium">not Claude alone</span></>} />
        <p className="mt-3 max-w-prose text-ink-muted">
          From our own dogfood (15 synthetic-bug PRs across 5 vibe-coder Next.js templates).
          Honest numbers; no marketing math.
        </p>
        <div className="mt-14 grid gap-x-10 gap-y-12 md:grid-cols-3">
          <Stat
            label="Catch rate"
            value="100%"
            sub="conclave 3-agent council, vs 100% Claude alone — both catch obvious bugs"
          />
          <Stat
            label="Blockers per PR"
            value="10.93"
            sub="vs 3.80 Claude alone — 3× deeper findings, including issues lost on a single model"
          />
          <Stat
            label="Spec-mismatch flags"
            value="9.0"
            unit="/PR"
            sub="(Claude alone + PRD): blocker categories that no plain code review surfaces"
          />
        </div>
        <p className="mt-16 max-w-prose text-[15px] text-ink-subtle leading-[1.65]">
          The moat isn&rsquo;t {`"smarter than Claude"`} —{" "}
          <span className="font-serif italic">it&rsquo;s multi-agent depth + PRD-aware spec compliance.</span>{" "}
          Three models reading your PR and PRD together catch scope creep, route mismatches, and
          forgotten acceptance criteria that one model alone misses.
        </p>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
}) {
  return (
    <article className="border-t border-paper-ruleHi pt-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute mb-3">
        {label}
      </p>
      <p className="font-display font-bold text-[clamp(3.5rem,7vw,5.5rem)] leading-none tracking-tightxx text-ink">
        {value}
        {unit ? <span className="text-ink-mute font-mono text-[0.4em] align-baseline ml-1">{unit}</span> : null}
      </p>
      <p className="mt-5 text-sm text-ink-muted leading-relaxed max-w-[34ch]">{sub}</p>
    </article>
  );
}

// --- Try-it-now demo --------------------------------------------------------

function DemoSection() {
  return (
    <section id="try" className="border-b border-paper-line">
      <div className="mx-auto max-w-page px-6 py-28">
        <SectionHeader mark="03 — try it" title="Run a council pass on a public PR" />
        <p className="mt-3 max-w-prose text-ink-muted">
          Paste a public PR URL or a raw diff. Optional PRD. One Claude pass with the PRD-aware
          prompt — same prompt the full council uses. Three runs per IP per UTC day; install the
          GitHub App for unlimited.
        </p>
        <div className="mt-12">
          <DemoForm />
        </div>
      </div>
    </section>
  );
}

// --- Pricing ----------------------------------------------------------------

function Pricing() {
  return (
    <section id="pricing" className="border-b border-paper-line bg-paper-dim/40">
      <div className="mx-auto max-w-page px-6 py-28">
        <SectionHeader mark="04 — pricing" title="Hard cutoffs. No surprise invoices." />
        <p className="mt-3 max-w-prose text-ink-muted">
          Booster top-ups instead of overage bills. BYO Anthropic key for free unlimited usage.
        </p>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <PriceCard
            tier="Free (BYO key)"
            price="$0"
            sub="bring your own Anthropic key"
            features={[
              "Unlimited reviews + autofix",
              "PR comment delivery",
              "Anonymous failure-pattern sharing",
              "All council features",
            ]}
            cta="Connect GitHub"
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
              "Telegram alerts (premium)",
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
              "Telegram alerts + priority sandbox",
              "Private mode (no data sharing)",
              "$5 booster",
            ]}
            cta="Start with Pro"
            ctaHref={LOGIN_URL}
          />
        </div>
        <p className="mt-10 max-w-prose text-xs text-ink-mute leading-relaxed">
          1 free review the moment you install the GitHub App — no card. After that, BYO key for
          free unlimited usage, or upgrade to Solo / Pro for Telegram alerts and priority delivery.
          Stripe metering ships once moat data accumulates from real usage.
        </p>
      </div>
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
      className={`relative card-lift rounded-md p-7 flex flex-col ${
        highlight
          ? "bg-paper border-2 border-paper-ruleHi shadow-plateHi"
          : "bg-paper border border-paper-line shadow-plate"
      }`}
    >
      {highlight ? (
        <span className="absolute -top-3 left-7 font-mono text-[10px] uppercase tracking-[0.22em] bg-accent-900 text-paper px-2 py-1 rounded">
          most popular
        </span>
      ) : null}
      <p
        className={`text-sm font-semibold ${
          highlight ? "text-accent-900" : "text-ink-subtle"
        }`}
      >
        {tier}
      </p>
      <p className="mt-4 flex items-baseline gap-2">
        <span className="font-display font-bold text-[3rem] leading-none tracking-tightxx text-ink">
          {price}
        </span>
        <span className="text-sm text-ink-mute">{sub}</span>
      </p>
      <ul className="mt-7 space-y-2.5 text-[14px] text-ink-subtle flex-1">
        {features.map((f) => (
          <li key={f} className="flex gap-3">
            <span
              className={`mt-1 h-1 w-3 flex-none ${
                highlight ? "bg-accent-900" : "bg-ink-ghost"
              }`}
              aria-hidden="true"
            />
            <span className="leading-snug">{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        className={`mt-8 block text-center rounded-md px-4 py-2.5 text-sm font-medium tracking-tight transition-colors ${
          highlight
            ? "bg-accent-900 text-paper hover:bg-accent-700"
            : "border border-paper-ruleHi text-ink hover:bg-paper-dim"
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
        "Yes — the free tier is BYO-key with unlimited usage. You opt into anonymous failure-pattern sharing in exchange. The trade is honest: we get data for the federated catalog; you get unlimited free reviews.",
    },
  ];
  return (
    <section id="faq" className="border-b border-paper-line">
      <div className="mx-auto max-w-page px-6 py-28">
        <SectionHeader mark="05 — questions" title="FAQ" />
        <dl className="mt-14 divide-y divide-paper-line border-y border-paper-line">
          {items.map((item) => (
            <div key={item.q} className="py-7 grid gap-x-10 md:grid-cols-12">
              <dt className="md:col-span-5 font-display text-xl font-semibold text-ink leading-snug tracking-tightx">
                {item.q}
              </dt>
              <dd className="md:col-span-7 mt-3 md:mt-1 text-[15px] text-ink-muted leading-[1.65] max-w-prose">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// --- Footer -----------------------------------------------------------------

function Footer() {
  return (
    <footer className="bg-paper">
      <div className="mx-auto max-w-page px-6 pt-20 pb-12 grid gap-10 md:grid-cols-12 text-sm">
        <div className="md:col-span-5">
          <Logo size={22} />
          <p className="mt-4 text-ink-muted max-w-xs leading-relaxed">
            Multi-agent code review against your PRD. Open beta on Cloudflare Workers + Containers.
          </p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-mute">
            v0.16 · {new Date().getFullYear()}
          </p>
        </div>
        <nav className="md:col-span-3 space-y-2.5 text-ink-muted">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute mb-3">
            Product
          </p>
          <a href="#how" className="block link-anim hover:text-ink">How it works</a>
          <a href="#try" className="block link-anim hover:text-ink">Try it</a>
          <a href="#pricing" className="block link-anim hover:text-ink">Pricing</a>
          <a href="#faq" className="block link-anim hover:text-ink">FAQ</a>
        </nav>
        <nav className="md:col-span-4 space-y-2.5 text-ink-muted">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute mb-3">
            Resources
          </p>
          <a
            href="https://github.com/seunghunbae-3svs/conclave-ai"
            className="block link-anim hover:text-ink"
            target="_blank"
            rel="noreferrer"
          >
            GitHub repo
          </a>
          <a
            href="https://github.com/apps/conclave-ai-code-council"
            className="block link-anim hover:text-ink"
            target="_blank"
            rel="noreferrer"
          >
            Install GitHub App
          </a>
          <a href="mailto:hi@conclave-ai.dev" className="block link-anim hover:text-ink">
            hi@conclave-ai.dev
          </a>
        </nav>
      </div>
      <div className="border-t border-paper-line">
        <div className="mx-auto max-w-page px-6 py-6 flex items-center justify-between text-xs text-ink-mute">
          <span>© {new Date().getFullYear()} 3SVS. All rights reserved.</span>
          <span className="font-mono tracking-wider">{SITE_URL.replace(/^https?:\/\//, "")}</span>
        </div>
      </div>
    </footer>
  );
}

// --- Shared ----------------------------------------------------------------

function SectionHeader({
  mark,
  title,
}: {
  mark: string;
  title: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">{mark}</p>
      <h2 className="mt-3 font-display font-bold text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] tracking-tightxx text-ink">
        {title}
      </h2>
    </div>
  );
}
