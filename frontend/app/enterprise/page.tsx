"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Brain,
  Building2,
  Check,
  Users,
  ShieldCheck,
  KeyRound,
  HeartHandshake,
  BarChart3,
  ArrowLeft,
  Send,
} from "lucide-react";

const enterpriseFeatures = [
  {
    icon: Users,
    title: "Team Seat Management",
    description: "Invite employees, assign seats, and track usage across your entire organisation from a single admin panel.",
  },
  {
    icon: KeyRound,
    title: "SSO / SAML Login",
    description: "Integrate with Okta, Azure AD, Google Workspace, or any SAML 2.0 provider — no separate passwords.",
  },
  {
    icon: ShieldCheck,
    title: "HIPAA BAA Available",
    description: "For healthcare, EAP, and clinical teams that need a signed Business Associate Agreement.",
  },
  {
    icon: BarChart3,
    title: "Org-Level Analytics",
    description: "Aggregate anonymised engagement and wellbeing trends across your team — without exposing individual data.",
  },
  {
    icon: HeartHandshake,
    title: "Dedicated Onboarding",
    description: "A customer success engineer helps you configure, roll out, and train your team.",
  },
  {
    icon: Building2,
    title: "Custom Data Retention",
    description: "Set your own retention window and data-residency requirements to match your security policy.",
  },
];

export default function EnterprisePage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Build mailto: link and open it so the user's mail client drafts the message.
    // This requires no backend infrastructure while still capturing the lead.
    const subject = encodeURIComponent(`Enterprise inquiry — ${company || "Unknown company"}`);
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nCompany: ${company}\nTeam size: ${teamSize}\n\n${message}`,
    );
    window.location.href = `mailto:hello@clarimetis.com?subject=${subject}&body=${body}`;
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#080810] text-slate-900 dark:text-slate-100">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-white/[0.05] bg-white/80 dark:bg-[#0c0c18]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative shrink-0">
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-indigo-500/40 to-violet-600/40 blur-md" />
              <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center ring-1 ring-white/[0.12]">
                <Brain size={13} className="text-white" />
              </div>
            </div>
            <span className="font-bold text-slate-900 dark:text-white text-[15px] tracking-tight">ClariMetis</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to home
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-amber-500/10 dark:bg-amber-500/[0.06] blur-3xl" />
        </div>

        <div className="inline-flex items-center gap-1.5 mb-6 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-100 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 text-[11px] font-semibold tracking-widest uppercase">
          <Building2 size={10} />
          Enterprise
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.1] mb-5">
          AI Mental Wellness,{" "}
          <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 bg-clip-text text-transparent">
            Built for Teams
          </span>
        </h1>
        <p className="max-w-2xl mx-auto text-lg text-slate-500 dark:text-slate-400 leading-relaxed">
          Give your employees, students, or clients access to ClariMetis with the security controls,
          compliance guarantees, and admin tooling your organisation needs.
        </p>
      </section>

      {/* ── Features ── */}
      <section className="relative bg-slate-50 dark:bg-[#0c0c18] py-20">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {enterpriseFeatures.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="bg-white dark:bg-[#13131f] rounded-2xl p-6 border border-slate-200 dark:border-amber-900/30 hover:border-amber-300 dark:hover:border-amber-700/50 hover:shadow-lg hover:shadow-amber-900/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800/40">
                  <Icon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 tracking-tight">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-500 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What you get vs Pro ── */}
      <section className="py-20 max-w-3xl mx-auto px-6">
        <h2 className="text-2xl font-bold tracking-tight text-center mb-10">Everything in Pro, plus:</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            "Team seat management & admin portal",
            "SSO / SAML 2.0 integration",
            "HIPAA Business Associate Agreement",
            "Org-level anonymised analytics",
            "Custom data retention policies",
            "Dedicated customer success manager",
            "Priority SLA (4-hour response)",
            "Annual invoiced billing",
            "Volume seat discounts",
            "Custom onboarding & training",
          ].map((item) => (
            <div key={item} className="flex items-start gap-2.5 text-sm">
              <Check size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <span className="text-slate-700 dark:text-slate-300">{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Contact form ── */}
      <section className="py-20 bg-slate-50 dark:bg-[#0c0c18]">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        <div className="max-w-xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold tracking-tight mb-2">Get in touch</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Tell us about your team and we&apos;ll be in touch within one business day.
            </p>
          </div>

          {submitted ? (
            <div className="bg-white dark:bg-[#13131f] rounded-2xl border border-amber-200 dark:border-amber-800/40 p-10 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
                <Send size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-2">Message sent!</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Your email client should have opened with the draft. We&apos;ll reply within one business day.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="bg-white dark:bg-[#13131f] rounded-2xl border border-slate-200 dark:border-indigo-900/40 p-8 space-y-5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                    Your name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-indigo-900/40 bg-slate-50 dark:bg-[#080810] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition"
                    placeholder="Jane Smith"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                    Work email <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-indigo-900/40 bg-slate-50 dark:bg-[#080810] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition"
                    placeholder="jane@company.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                    Company <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-indigo-900/40 bg-slate-50 dark:bg-[#080810] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition"
                    placeholder="Acme Corp"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                    Team size
                  </label>
                  <select
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-indigo-900/40 bg-slate-50 dark:bg-[#080810] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition"
                  >
                    <option value="">Select…</option>
                    <option>10–49</option>
                    <option>50–199</option>
                    <option>200–999</option>
                    <option>1 000+</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  Tell us about your use case
                </label>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-indigo-900/40 bg-slate-50 dark:bg-[#080810] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition resize-none"
                  placeholder="Employee wellness programme, clinical practice, university counselling…"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-white font-semibold text-sm transition-all shadow-md shadow-amber-900/20 ring-1 ring-white/[0.10] inline-flex items-center justify-center gap-2"
              >
                <Send size={14} />
                Send inquiry
              </button>

              <p className="text-center text-xs text-slate-400 dark:text-slate-600">
                Or email us directly at{" "}
                <a href="mailto:hello@clarimetis.com" className="text-amber-600 dark:text-amber-400 hover:underline">
                  hello@clarimetis.com
                </a>
              </p>
            </form>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative border-t border-slate-200/60 dark:border-white/[0.05] py-10 text-center text-xs text-slate-400 dark:text-slate-600 px-6">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
        <p className="italic mb-1">
          ClariMetis is an AI life coaching companion, not a licensed therapist or medical professional.
        </p>
        <p>
          In a mental health crisis, call or text{" "}
          <strong className="text-slate-600 dark:text-slate-400">988</strong> (US Suicide &amp; Crisis Lifeline).
        </p>
        <p className="mt-4">© {new Date().getFullYear()} ClariMetis. All rights reserved.</p>
      </footer>
    </div>
  );
}
