/**
 * Conclave AI — landing page (judicial-conclave concept).
 *
 * Aesthetic: 17th-century printed broadsheet meets council ballot.
 * - Bodoni Moda for display (high-contrast didone, classical authority).
 * - Crimson Pro serif for body (modulated old-style serif).
 * - Newsreader Italic for pulled quotes / emphasis voice.
 * - JetBrains Mono for cli + numerics.
 * - Parchment cream (#F4ECDC) with vellum noise + faint gold/oxblood
 *   radial wash (globals.css).
 * - Oxblood (#5C111C) as the council's seal color — primary CTA, the
 *   highlighted Solo card, verdict emphasis. Sparing — 5–8% surface.
 * - Gold leaf (#9B7A30) for hover underlines, section rules, accent
 *   ornaments.
 * - Roman numerals (I–V) on section headings; mono ops marker
 *   underneath.
 * - Drop caps on the first paragraph of each section's body.
 *
 * Sections (top → bottom):
 *   I.   Hero
 *   II.  How it convenes
 *   III. Council evidence
 *   IV.  Try it now (DemoForm)
 *   V.   Indulgences (pricing)
 *   VI.  FAQ
 *   Footer
 */
import { Logo } from "../components/Logo";
import { DemoForm } from "../components/DemoForm";

const SITE_URL = "https://conclave-ai.dev";

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
    <header className="sticky top-0 z-50 border-b border-parchment-line bg-parchment/85 backdrop-blur-sm">
      <div className="mx-auto max-w-page px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 group">
          <Logo size={22} className="group-hover:opacity-80 transition-opacity" />
        </a>
        <nav className="flex items-center gap-7 text-[15px] text-ink-subtle">
          <a href="#how" className="link-anim hover:text-ink">How</a>
          <a href="#try" className="link-anim hover:text-ink">Try</a>
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
            className="rounded-sm bg-oxblood-600 hover:bg-oxblood-500 transition-colors text-parchment-light px-3.5 py-1.5 text-xs font-mono uppercase tracking-widetracked"
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
    <section className="bg-grid border-b border-parchment-line relative overflow-hidden">
      {/* Wax seal in the upper-right margin — decorative, slow rotate
          on its own keyframe so it reads as imprinted, not a clickable
          element. */}
      <div className="hidden lg:block absolute top-20 right-12 lg:right-20 w-28 h-28 wax-seal animate-sealPulse pointer-events-none">
        <div className="absolute inset-0 flex items-center justify-center text-parchment-light font-display text-2xl italic font-medium tracking-wider">
          C·AI
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 pt-24 pb-28 md:pt-32 md:pb-36 animate-rise">
        <div className="flex items-center gap-3 mb-9">
          <span className="font-mono text-[11px] uppercase tracking-widetracked text-ink-mute">
            v0.16 · MMXXVI
          </span>
          <span className="h-px flex-1 bg-parchment-line" />
          <span className="font-mono text-[11px] uppercase tracking-widetracked text-ink-mute">
            council convened
          </span>
        </div>

        <h1 className="font-display font-medium text-[clamp(2.75rem,6.4vw,5rem)] leading-[1.02] tracking-tightxx text-ink">
          A council of AI agents
          <br />
          convenes for every PR
          <br />
          <span className="font-italic italic font-medium text-oxblood-600">against your PRD.</span>
        </h1>

        <p className="mt-9 text-xl text-ink-subtle leading-[1.55]">
          Three frontier models — Claude, GPT‑5, and Gemini — read your pull request
          independently, then bring their findings to a sealed deliberation. Disagreement is
          reconciled in a second tier. The verdict and dissents land on the PR with the
          authority of all three.
        </p>

        <p className="mt-5 font-italic italic text-lg text-ink-muted">
          Ex pluribus, iudicium. — Out of many, one judgement.
        </p>

        {/* CTAs — left aligned within the centered narrow column. */}
        <div className="mt-12 grid gap-4 sm:grid-cols-[auto_1fr] items-stretch">
          <SignInButton />
          <InstallCommand />
        </div>
        <p className="mt-7 text-sm text-ink-mute">
          Open beta · 1 free hearing on installation · BYO Anthropic key for unlimited reviews · Solo $19/mo
        </p>
      </div>
    </section>
  );
}

function SignInButton() {
  return (
    <a
      href={LOGIN_URL}
      className="block rounded-sm bg-oxblood-600 hover:bg-oxblood-500 transition-colors text-parchment-light px-7 py-4 text-center font-display font-medium text-lg shadow-plate"
    >
      <span>Convene the council</span>
      <span aria-hidden="true" className="ml-2.5 inline-block">→</span>
      <span className="block mt-0.5 text-[10px] font-mono tracking-widetracked uppercase opacity-75">
        installs the github app
      </span>
    </a>
  );
}

function InstallCommand() {
  return (
    <div className="rounded-sm border border-ink/15 bg-ink text-parchment font-mono text-[13px] overflow-hidden shadow-plate">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-parchment/10">
        <span className="h-2 w-2 rounded-full bg-parchment/30" />
        <span className="h-2 w-2 rounded-full bg-parchment/30" />
        <span className="h-2 w-2 rounded-full bg-parchment/30" />
        <span className="ml-2 text-[10px] tracking-widetracked uppercase text-parchment/50">
          power-user cli
        </span>
      </div>
      <pre className="px-4 py-3 leading-relaxed">
        <span className="text-gold">$</span>{" "}
        <span className="text-parchment">npm i -g @conclave-ai/cli</span>
      </pre>
    </div>
  );
}

// --- How it works -----------------------------------------------------------

function HowItWorks() {
  const steps = [
    {
      n: "I",
      title: "Install the seal",
      body:
        "One click installs the Conclave AI Code Council GitHub App. It subscribes to your repository's pull-request events; nothing runs in your CI. The work happens in our sandbox, sealed away from your build.",
    },
    {
      n: "II",
      title: "Lodge your PRD",
      body:
        ".conclave/prd.md describes what the change is supposed to accomplish — acceptance criteria, out-of-scope, non-functional requirements. Agents read it before deliberation and flag spec deviations as first-class blockers.",
    },
    {
      n: "III",
      title: "Receive the verdict",
      body:
        "Three agents review independently. Disagreements escalate to a second tier. The verdict — APPROVE, REWORK, or REJECT — and any dissents land on the PR as a check and a comment. Solo and Pro tiers also dispatch the result to Telegram.",
    },
  ];
  return (
    <section id="how" className="border-b border-parchment-line bg-parchment-dim/40">
      <div className="mx-auto max-w-page px-6 py-32">
        <SectionHeader numeral="II" mark="proceedings" title="How the council convenes" />
        <p className="mt-5 max-w-prose text-ink-muted text-lg leading-relaxed">
          Three steps. No CI changes. No keys to manage on your end (unless you wish to bring your own).
        </p>
        <ol className="mt-16 grid gap-px md:grid-cols-3 bg-parchment-line border-y border-ink/15">
          {steps.map((s) => (
            <li
              key={s.n}
              className="bg-parchment px-8 py-10 group hover:bg-parchment-light transition-colors"
            >
              <p className="numeral text-3xl mb-2">{s.n}</p>
              <div className="gold-rule mb-6 w-12" />
              <h3 className="font-display text-2xl font-semibold text-ink leading-snug tracking-tightx mb-4">
                {s.title}
              </h3>
              <p className="text-[16px] text-ink-muted leading-[1.7]">{s.body}</p>
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
    <section className="border-b border-parchment-line">
      <div className="mx-auto max-w-page px-6 py-32">
        <SectionHeader
          numeral="III"
          mark="evidence"
          title={<>Why a council, <span className="font-italic italic">not Claude alone</span></>}
        />
        <p className="mt-5 max-w-prose text-ink-muted text-lg leading-relaxed drop-cap">
          From our own dogfood — fifteen synthetic-bug pull requests across five vibe-coder
          Next.js templates. Honest figures; no apology, no marketing arithmetic.
        </p>
        <div className="mt-20 grid gap-x-12 gap-y-14 md:grid-cols-3">
          <Stat
            label="Catch rate"
            value="100%"
            sub="conclave 3-agent council, vs 100% Claude alone — both catch obvious bugs"
          />
          <Stat
            label="Blockers per PR"
            value="10.93"
            sub="vs 3.80 Claude alone — three times deeper findings, including issues lost on a single model"
          />
          <Stat
            label="Spec-mismatch flags"
            value="9.0"
            unit="/PR"
            sub="(Claude alone, with PRD attached) — blocker categories that no plain code review surfaces"
          />
        </div>
        <div className="mt-20 max-w-prose">
          <p className="font-italic italic text-2xl text-ink-subtle leading-snug">
            The moat is not “smarter than Claude.” It is multi-agent depth and PRD-aware spec
            compliance — three models reading your change and your spec together catch scope
            creep, route mismatches, and forgotten acceptance criteria a single model alone
            misses.
          </p>
        </div>
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
    <article>
      <div className="rule-thick mb-5" />
      <p className="font-mono text-[11px] uppercase tracking-widetracked text-ink-mute mb-3">
        {label}
      </p>
      <p className="font-display font-medium text-[clamp(3.75rem,7vw,5.75rem)] leading-none tracking-tightxx text-ink">
        {value}
        {unit ? <span className="text-ink-mute font-mono text-[0.36em] align-baseline ml-1.5">{unit}</span> : null}
      </p>
      <p className="mt-6 text-[15px] text-ink-muted leading-relaxed max-w-[34ch]">{sub}</p>
    </article>
  );
}

// --- Try-it-now demo --------------------------------------------------------

function DemoSection() {
  return (
    <section id="try" className="border-b border-parchment-line bg-parchment-dim/40">
      <div className="mx-auto max-w-page px-6 py-32">
        <SectionHeader numeral="IV" mark="hearing" title="Lodge a public PR for an opening hearing" />
        <p className="mt-5 max-w-prose text-ink-muted text-lg leading-relaxed">
          Paste a public pull request URL or a raw diff. Optionally attach a PRD by drag-drop,
          file picker, or a GitHub URL. One Claude pass with the PRD-aware prompt — the same
          prompt the full council uses. Three opening hearings per IP per UTC day; install the
          App for the full three-agent council.
        </p>
        <div className="mt-14">
          <DemoForm />
        </div>
      </div>
    </section>
  );
}

// --- Pricing ----------------------------------------------------------------

function Pricing() {
  return (
    <section id="pricing" className="border-b border-parchment-line">
      <div className="mx-auto max-w-page px-6 py-32">
        <SectionHeader numeral="V" mark="indulgences" title="Indulgences" />
        <p className="mt-5 max-w-prose text-ink-muted text-lg leading-relaxed">
          Hard cutoffs, no surprise invoices. Booster top-ups instead of overage bills. Bring
          your own Anthropic key for free unlimited usage.
        </p>
        <div className="mt-16 grid gap-7 md:grid-cols-3">
          <PriceCard
            tier="Free"
            sub="bring your own Anthropic key"
            price="$0"
            features={[
              "Unlimited reviews + autofix",
              "PR comment delivery",
              "Anonymous failure-pattern sharing",
              "All council features",
            ]}
            cta="Convene the council"
            ctaHref={LOGIN_URL}
          />
          <PriceCard
            tier="Solo"
            sub="per month"
            price="$19"
            highlight
            features={[
              "30 reviews / month",
              "10 autofix cycles / month",
              "Council + PRD layer",
              "Telegram dispatches (premium)",
              "$5 booster: +5 reviews",
            ]}
            cta="Choose Solo"
            ctaHref={LOGIN_URL}
          />
          <PriceCard
            tier="Pro"
            sub="per month"
            price="$49"
            features={[
              "80 reviews / month",
              "30 autofix cycles / month",
              "Telegram dispatches + priority sandbox",
              "Private mode (no data sharing)",
              "$5 booster",
            ]}
            cta="Choose Pro"
            ctaHref={LOGIN_URL}
          />
        </div>
        <p className="mt-12 max-w-prose text-sm text-ink-mute leading-relaxed">
          One free hearing the moment you install the GitHub App — no card. Thereafter, bring
          your own key for unlimited free, or choose Solo / Pro for premium dispatches and
          priority. Stripe metering ships once moat data accumulates from real usage.
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
      className={`relative card-lift rounded-sm p-8 flex flex-col ${
        highlight
          ? "bg-parchment-light shadow-seal"
          : "bg-parchment border border-parchment-line shadow-plate"
      }`}
    >
      {highlight ? (
        <span className="absolute -top-3 left-8 font-mono text-[10px] uppercase tracking-widetracked bg-oxblood-600 text-parchment-light px-3 py-1 rounded-sm">
          recommended
        </span>
      ) : null}
      <p
        className={`font-display text-xl font-medium tracking-tight ${
          highlight ? "text-oxblood-600" : "text-ink-subtle"
        }`}
      >
        {tier}
      </p>
      <p className="mt-5 flex items-baseline gap-2.5">
        <span className="font-display font-medium text-[3.25rem] leading-none tracking-tightxx text-ink lining-nums">
          {price}
        </span>
        <span className="text-sm text-ink-mute italic">{sub}</span>
      </p>
      <div className={`mt-7 mb-7 ${highlight ? "gold-rule" : "rule-thin"}`} />
      <ul className="space-y-3 text-[15px] text-ink-subtle flex-1 leading-relaxed">
        {features.map((f) => (
          <li key={f} className="flex gap-3">
            <span
              className={`mt-2 h-1 w-3 flex-none ${
                highlight ? "bg-oxblood-600" : "bg-ink-ghost"
              }`}
              aria-hidden="true"
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        className={`mt-9 block text-center rounded-sm px-4 py-3 text-[15px] font-display font-medium tracking-tight transition-colors ${
          highlight
            ? "bg-oxblood-600 text-parchment-light hover:bg-oxblood-500"
            : "border border-ink/30 text-ink hover:bg-parchment-dim"
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
        "Those are IDE assistants. Conclave AI sits at the pull-request layer with three independent agents and reads your PRD. A different layer; a different value: catches what single-agent review misses, and flags spec deviations no plain code review can produce.",
    },
    {
      q: "What does the council see from my repo?",
      a:
        "Only the diff and the files referenced in blockers — the same surface a human reviewer touches. Code never leaves our sandbox. Federated learning shares only anonymised signals (kind, category, severity hash, day-bucket, sha256). See docs/federated-sync.md.",
    },
    {
      q: "Do I need to install anything in CI?",
      a:
        "No. The GitHub App receives webhooks; review and autofix run inside our Cloudflare Containers sandbox. Your CI stays untouched.",
    },
    {
      q: "May I bring my own Anthropic key?",
      a:
        "Yes — the free tier is BYO-key with unlimited usage. You opt into anonymous failure-pattern sharing in exchange. The trade is honest: we receive data to make the federated catalog smarter; you receive unlimited free reviews.",
    },
  ];
  return (
    <section id="faq" className="border-b border-parchment-line bg-parchment-dim/40">
      <div className="mx-auto max-w-page px-6 py-32">
        <SectionHeader numeral="VI" mark="questions" title="Disquisitions" />
        <dl className="mt-16 divide-y divide-ink/15 border-y border-ink/15">
          {items.map((item) => (
            <div key={item.q} className="py-9 grid gap-x-10 md:grid-cols-12">
              <dt className="md:col-span-5 font-display text-2xl font-medium text-ink leading-snug tracking-tightx">
                {item.q}
              </dt>
              <dd className="md:col-span-7 mt-3 md:mt-1 text-[16px] text-ink-muted leading-[1.7] max-w-prose">
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
    <footer className="bg-parchment">
      <div className="mx-auto max-w-page px-6 pt-20 pb-12 grid gap-10 md:grid-cols-12 text-[15px]">
        <div className="md:col-span-5">
          <Logo size={22} />
          <p className="mt-5 text-ink-muted max-w-xs leading-relaxed">
            A council of agents convened for every pull request — running on Cloudflare Workers and
            Containers. Open beta.
          </p>
          <p className="mt-5 numeral text-base">
            v0.16 · MMXXVI
          </p>
        </div>
        <nav className="md:col-span-3 space-y-3 text-ink-muted">
          <p className="font-mono text-[11px] uppercase tracking-widetracked text-ink-mute mb-4">
            Order
          </p>
          <a href="#how" className="block link-anim hover:text-ink">How it works</a>
          <a href="#try" className="block link-anim hover:text-ink">Try it</a>
          <a href="#pricing" className="block link-anim hover:text-ink">Indulgences</a>
          <a href="#faq" className="block link-anim hover:text-ink">Disquisitions</a>
        </nav>
        <nav className="md:col-span-4 space-y-3 text-ink-muted">
          <p className="font-mono text-[11px] uppercase tracking-widetracked text-ink-mute mb-4">
            Archives
          </p>
          <a
            href="https://github.com/seunghunbae-3svs/conclave-ai"
            className="block link-anim hover:text-ink"
            target="_blank"
            rel="noreferrer"
          >
            GitHub repository
          </a>
          <a
            href="https://github.com/apps/conclave-ai-code-council"
            className="block link-anim hover:text-ink"
            target="_blank"
            rel="noreferrer"
          >
            Install the GitHub App
          </a>
          <a href="mailto:hi@conclave-ai.dev" className="block link-anim hover:text-ink">
            hi@conclave-ai.dev
          </a>
        </nav>
      </div>
      <div className="border-t border-parchment-line">
        <div className="mx-auto max-w-page px-6 py-6 flex items-center justify-between text-xs text-ink-mute">
          <span className="italic">© {new Date().getFullYear()} 3SVS · Sealed in Seoul.</span>
          <span className="font-mono tracking-wider">{SITE_URL.replace(/^https?:\/\//, "")}</span>
        </div>
      </div>
    </footer>
  );
}

// --- Shared ----------------------------------------------------------------

function SectionHeader({
  numeral,
  mark,
  title,
}: {
  numeral: string;
  mark: string;
  title: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-4 mb-3">
        <p className="numeral text-3xl">{numeral}</p>
        <span className="gold-rule flex-1 max-w-[100px]" />
        <p className="font-mono text-[11px] uppercase tracking-widetracked text-ink-mute">{mark}</p>
      </div>
      <h2 className="font-display font-medium text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.05] tracking-tightxx text-ink">
        {title}
      </h2>
    </div>
  );
}
