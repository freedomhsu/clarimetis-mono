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
} from "lucide-react";

const features = [
  {
    icon: ShieldCheck,
    title: "Private & Secure",
    description:
      "End-to-end encrypted sessions. Your conversations are never sold or used to train third-party models.",
    iconBg: "bg-emerald-50 dark:bg-emerald-900/30",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  {
    icon: Fingerprint,
    title: "Personalized to You",
    description:
      "The AI builds a memory of your patterns, values, and goals over time — so every session starts where you left off.",
    iconBg: "bg-violet-50 dark:bg-violet-900/30",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  {
    icon: BrainCircuit,
    title: "Cognitive Insights",
    description:
      "Identifies cognitive biases and thinking patterns from your conversations to help you grow beyond them.",
    iconBg: "bg-sky-50 dark:bg-sky-900/30",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
  {
    icon: BarChart3,
    title: "Progress Metrics",
    description:
      "Track mood trends, session streaks, and growth areas with a clear, visual insights dashboard.",
    iconBg: "bg-orange-50 dark:bg-orange-900/30",
    iconColor: "text-orange-600 dark:text-orange-400",
  },
  {
    icon: Mic,
    title: "Voice Input",
    description:
      "Speak naturally instead of typing. Audio is transcribed and processed with full context awareness.",
    iconBg: "bg-pink-50 dark:bg-pink-900/30",
    iconColor: "text-pink-600 dark:text-pink-400",
  },
  {
    icon: ImagePlus,
    title: "Media Uploads",
    description:
      "Share screenshots, journal photos, or documents and let the AI incorporate them into your session.",
    iconBg: "bg-teal-50 dark:bg-teal-900/30",
    iconColor: "text-teal-600 dark:text-teal-400",
  },
  {
    icon: Zap,
    title: "Always Available",
    description:
      "No scheduling, no waitlists. Your coach is ready at 2 am, on weekends, and whenever you need it.",
    iconBg: "bg-amber-50 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  {
    icon: HeartHandshake,
    title: "Crisis Detection",
    description:
      "Built-in safety layer monitors for signs of crisis and surfaces emergency resources immediately.",
    iconBg: "bg-rose-50 dark:bg-rose-900/30",
    iconColor: "text-rose-600 dark:text-rose-400",
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
    items: ["5 messages per day", "All coaching agents", "Session history"],
  },
  {
    name: "Pro Monthly",
    price: "$9.99",
    period: "/ mo",
    description: "Unlimited access, cancel anytime.",
    cta: "Start Pro",
    href: "/sign-up",
    highlighted: true,
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
    price: "$99",
    period: "/ yr",
    description: "2 months free vs. monthly.",
    cta: "Start Annual",
    href: "/sign-up",
    highlighted: false,
    items: [
      "Everything in Pro Monthly",
      "Best value — save $20.88/yr",
    ],
  },
];

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-bold text-brand-600 dark:text-brand-400 text-lg tracking-tight">
            ClariMetis
          </span>
          <div className="flex gap-3">
            <Link
              href="/sign-in"
              className="px-4 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-1.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-block mb-4 px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-xs font-semibold tracking-wide uppercase">
          AI Wellness Coach
        </div>
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight leading-tight mb-6">
          Clarity starts with{" "}
          <span className="text-brand-600 dark:text-brand-400">understanding yourself</span>
        </h1>
        <p className="max-w-2xl mx-auto text-xl text-gray-500 dark:text-gray-400 leading-relaxed mb-10">
          ClariMetis is your personal AI companion for stress management, cognitive growth, and
          life coaching — available 24 / 7, private by design.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link
            href="/sign-up"
            className="px-8 py-3.5 bg-brand-600 text-white rounded-xl font-semibold text-lg hover:bg-brand-700 transition-colors shadow-md shadow-brand-200 dark:shadow-none"
          >
            Start for Free
          </Link>
          <Link
            href="/sign-in"
            className="px-8 py-3.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold text-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </section>

      {/* Features grid */}
      <section className="bg-gray-50 dark:bg-gray-900 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-3">Everything you need to grow</h2>
          <p className="text-center text-gray-500 dark:text-gray-400 mb-12 max-w-xl mx-auto">
            Built with the tools that make coaching actually effective — not just a chat window.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map(({ icon: Icon, title, description, iconBg, iconColor }) => (
              <div
                key={title}
                className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100 dark:border-gray-700"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${iconBg}`}>
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-3">Simple, honest pricing</h2>
          <p className="text-center text-gray-500 dark:text-gray-400 mb-12">
            Start free. Upgrade when you&apos;re ready.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl p-8 border flex flex-col ${
                  tier.highlighted
                    ? "border-brand-500 bg-brand-600 text-white shadow-xl shadow-brand-200 dark:shadow-brand-900/30"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                }`}
              >
                <div className="mb-6">
                  <p
                    className={`text-sm font-semibold uppercase tracking-wide mb-1 ${
                      tier.highlighted ? "text-brand-100" : "text-brand-600 dark:text-brand-400"
                    }`}
                  >
                    {tier.name}
                  </p>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold">{tier.price}</span>
                    <span
                      className={`text-sm pb-1 ${
                        tier.highlighted ? "text-brand-200" : "text-gray-400"
                      }`}
                    >
                      {tier.period}
                    </span>
                  </div>
                  <p
                    className={`text-sm mt-1 ${
                      tier.highlighted ? "text-brand-100" : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {tier.description}
                  </p>
                </div>
                <ul className="space-y-2 mb-8 flex-1">
                  {tier.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <span
                        className={`mt-0.5 text-lg leading-none ${
                          tier.highlighted ? "text-brand-200" : "text-brand-500"
                        }`}
                      >
                        ✓
                      </span>
                      <span
                        className={
                          tier.highlighted ? "text-white" : "text-gray-600 dark:text-gray-300"
                        }
                      >
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={tier.href}
                  className={`block text-center py-3 rounded-xl font-semibold transition-colors ${
                    tier.highlighted
                      ? "bg-white text-brand-600 hover:bg-brand-50"
                      : "bg-brand-600 text-white hover:bg-brand-700"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 dark:border-gray-800 py-10 text-center text-xs text-gray-400 dark:text-gray-500 px-6">
        <p className="italic mb-1">
          ClariMetis is an AI wellness coaching companion, not a licensed therapist or medical
          professional.
        </p>
        <p>
          In a mental health crisis, call or text{" "}
          <strong className="text-gray-600 dark:text-gray-300">988</strong> (US Suicide &amp;
          Crisis Lifeline).
        </p>
        <p className="mt-4">© {new Date().getFullYear()} ClariMetis. All rights reserved.</p>
      </footer>
    </div>
  );
}
