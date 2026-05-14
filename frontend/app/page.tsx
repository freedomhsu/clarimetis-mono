import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  ShieldCheck,
  Fingerprint,
  BrainCircuit,
  BarChart3,
  Mic,
  ImagePlus,
  Zap,
  HeartHandshake,
  Brain,
  ArrowRight,
  Check,
  Building2,
} from "lucide-react";

const features = [
  {
    icon: ShieldCheck,
    title: "Private & Secure",
    description:
      "End-to-end encrypted sessions. Your conversations are never sold or used to train third-party models.",
  },
  {
    icon: Fingerprint,
    title: "Personalized to You",
    description:
      "The AI builds a memory of your patterns, values, and goals over time — so every session starts where you left off.",
  },
  {
    icon: BrainCircuit,
    title: "Cognitive Insights",
    description:
      "Identifies cognitive biases and thinking patterns from your conversations to help you grow beyond them.",
  },
  {
    icon: BarChart3,
    title: "Progress Metrics",
    description:
      "Track mood trends, session streaks, and growth areas with a clear, visual insights dashboard.",
  },
  {
    icon: Mic,
    title: "Voice Input",
    description:
      "Speak naturally instead of typing. Audio is transcribed and processed with full context awareness.",
  },
  {
    icon: ImagePlus,
    title: "Media Uploads",
    description:
      "Share screenshots, journal photos, or documents and let the AI incorporate them into your session.",
  },
  {
    icon: Zap,
    title: "Always Available",
    description:
      "No scheduling, no waitlists. Your coach is ready at 2 am, on weekends, and whenever you need it.",
  },
  {
    icon: HeartHandshake,
    title: "Crisis Detection",
    description:
      "Built-in safety layer monitors for signs of crisis and surfaces emergency resources immediately.",
  },
];

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "",
    description: "Try it out, no card required.",
    cta: "Get Started Free",
    href: "/sign-up",
    highlighted: false,
    enterprise: false,
    items: ["5 messages per day", "All coaching agents", "Session history"],
  },
  {
    name: "Pro Monthly",
    price: "$9.99",
    period: "/ mo",
    description: "7 days free, then $9.99/mo — cancel anytime.",
    cta: "Start Free Trial",
    href: "/sign-up",
    highlighted: true,
    enterprise: false,
    items: [
      "Unlimited messages",
      "Voice input",
      "Media uploads",
      "Insights dashboard",
      "Priority support",
    ],
  },
  {
    name: "Pro Annual",
    price: "$99.99",
    period: "/ yr",
    description: "2 months free vs. monthly.",
    cta: "Start Annual",
    href: "/sign-up",
    highlighted: false,
    enterprise: false,
    items: [
      "Everything in Pro Monthly",
      "Best value — save $20.88/yr",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For teams, clinics, and HR programs.",
    cta: "Contact Us",
    href: "/enterprise",
    highlighted: false,
    enterprise: true,
    items: [
      "Everything in Pro",
      "Team seat management",
      "SSO / SAML login",
      "Dedicated onboarding",
      "SLA & priority support",
      "Custom data retention",
      "HIPAA BAA available",
    ],
  },
];

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-white dark:bg-[#080810] text-slate-900 dark:text-slate-100">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-white/[0.05] bg-white/80 dark:bg-[#0c0c18]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-indigo-500/40 to-violet-600/40 blur-md" />
              <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center ring-1 ring-white/[0.12]">
                <Brain size={13} className="text-white" />
              </div>
            </div>
            <span className="font-bold text-slate-900 dark:text-white text-[15px] tracking-tight">ClariMetis</span>
          </div>
          <div className="flex gap-2">
            <Link
              href="/sign-in"
              className="px-4 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-1.5 text-sm font-semibold bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white rounded-lg transition-all shadow-sm shadow-indigo-900/20 ring-1 ring-white/[0.10]"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden max-w-6xl mx-auto px-6 pt-28 pb-24 text-center">
        {/* Background ambient glows */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-indigo-500/10 dark:bg-indigo-500/[0.07] blur-3xl" />
          <div className="absolute top-20 left-1/3 w-[300px] h-[200px] rounded-full bg-violet-500/10 dark:bg-violet-500/[0.05] blur-3xl" />
        </div>

        {/* Eyebrow badge */}
        <div className="inline-flex items-center gap-1.5 mb-6 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold tracking-widest uppercase">
          <Brain size={10} />
          AI Life Coach
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.08] mb-6">
          End Social Fear,{" "}
          <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent">
            Talk Freely
          </span>
        </h1>
        <p className="max-w-2xl mx-auto text-xl text-slate-500 dark:text-slate-400 leading-relaxed mb-10">
          ClariMetis is your personal AI companion for stress management, cognitive growth, and
          life coaching — available 24/7, private by design.
        </p>

        {/* CTAs */}
        <div className="flex gap-3 justify-center flex-wrap mb-14">
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white rounded-xl font-semibold text-[15px] transition-all shadow-xl shadow-indigo-900/25 ring-1 ring-white/[0.10]"
          >
            Start for Free
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/sign-in"
            className="px-8 py-3.5 border border-slate-200 dark:border-indigo-900/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-[15px] hover:bg-slate-50 dark:hover:bg-[#13131f] hover:border-indigo-300 dark:hover:border-indigo-700/60 transition-all"
          >
            Sign In
          </Link>
        </div>

        {/* Trust signals row */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {["No credit card required", "End-to-end encrypted", "Cancel anytime", "Crisis-aware"].map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-500">
              <Check size={11} className="text-indigo-500 dark:text-indigo-400" />
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* ── Features grid ── */}
      <section className="relative bg-slate-50 dark:bg-[#0c0c18] py-24">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Everything you need to grow</h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
              Built with the tools that make coaching actually effective — not just a chat window.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="group bg-white dark:bg-[#13131f] rounded-2xl p-6 border border-slate-200 dark:border-indigo-900/40 hover:border-indigo-300 dark:hover:border-indigo-700/60 hover:shadow-lg hover:shadow-indigo-900/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
                  <Icon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 tracking-tight">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-500 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Simple, honest pricing</h2>
            <p className="text-slate-500 dark:text-slate-400">
              Start free. Upgrade when you&apos;re ready.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl p-8 border flex flex-col overflow-hidden ${
                  tier.highlighted
                    ? "border-indigo-500/50 bg-gradient-to-br from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-900/30 ring-1 ring-white/[0.10]"
                    : tier.enterprise
                    ? "border-amber-400/40 dark:border-amber-500/30 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-[#1a1508] dark:to-[#131310] shadow-lg shadow-amber-900/10"
                    : "border-slate-200 dark:border-indigo-900/40 bg-white dark:bg-[#13131f]"
                }`}
              >
                {/* Inner ambient for highlighted card */}
                {tier.highlighted && (
                  <div className="pointer-events-none absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-violet-400/10 to-transparent" />
                )}
                {/* Enterprise badge */}
                {tier.enterprise && (
                  <div className="absolute top-4 right-4">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300/60 dark:border-amber-600/40 text-amber-700 dark:text-amber-400 text-[9px] font-bold uppercase tracking-widest">
                      <Building2 size={8} />
                      Teams
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                    tier.highlighted
                      ? "text-indigo-200"
                      : tier.enterprise
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-indigo-500 dark:text-indigo-400"
                  }`}>
                    {tier.name}
                  </p>
                  <div className="flex items-end gap-1">
                    <span className={`text-4xl font-extrabold tracking-tight ${
                      tier.highlighted
                        ? "text-white"
                        : tier.enterprise
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-slate-900 dark:text-white"
                    }`}>
                      {tier.price}
                    </span>
                    <span className={`text-sm pb-1 ${
                      tier.highlighted ? "text-indigo-200" : tier.enterprise ? "text-amber-500" : "text-slate-400"
                    }`}>
                      {tier.period}
                    </span>
                  </div>
                  <p className={`text-sm mt-1 ${
                    tier.highlighted
                      ? "text-indigo-100"
                      : tier.enterprise
                      ? "text-amber-600 dark:text-amber-500"
                      : "text-slate-500 dark:text-slate-400"
                  }`}>
                    {tier.description}
                  </p>
                </div>

                <ul className="space-y-2 mb-8 flex-1">
                  {tier.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 shrink-0 ${
                        tier.highlighted
                          ? "text-indigo-200"
                          : tier.enterprise
                          ? "text-amber-500 dark:text-amber-400"
                          : "text-indigo-500 dark:text-indigo-400"
                      }`}>
                        <Check size={14} />
                      </span>
                      <span className={
                        tier.highlighted
                          ? "text-white"
                          : tier.enterprise
                          ? "text-slate-700 dark:text-slate-300"
                          : "text-slate-600 dark:text-slate-300"
                      }>
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.href}
                  className={`block text-center py-3 rounded-xl font-semibold text-sm transition-all ${
                    tier.highlighted
                      ? "bg-white text-indigo-600 hover:bg-indigo-50 shadow-md"
                      : tier.enterprise
                      ? "bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-white shadow-md shadow-amber-900/20 ring-1 ring-white/[0.10]"
                      : "bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white shadow-md shadow-indigo-900/20 ring-1 ring-white/[0.10]"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative border-t border-slate-200/60 dark:border-white/[0.05] py-10 text-center text-xs text-slate-400 dark:text-slate-600 px-6">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
        <p className="italic mb-1">
          ClariMetis is an AI life coaching companion, not a licensed therapist or medical
          professional.
        </p>
        <p>
          In a mental health crisis, call or text{" "}
          <strong className="text-slate-600 dark:text-slate-400">988</strong> (US Suicide &amp;
          Crisis Lifeline).
        </p>
        <p className="mt-4">© {new Date().getFullYear()} ClariMetis. All rights reserved.</p>
      </footer>
    </div>
  );
}


