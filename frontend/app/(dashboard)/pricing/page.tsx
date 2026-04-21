"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  X,
  Zap,
  Loader2,
  MessageCircle,
  Mic,
  BarChart2,
  ImagePlus,
  BrainCircuit,
  ShieldCheck,
  ArrowLeft,
} from "lucide-react";
import { useDashboard } from "@/components/providers/DashboardContext";
import type { BillingCycle } from "@/lib/hooks/useBilling";

const freeFeatures = [
  { icon: MessageCircle, label: "5 text messages per day", included: true },
  { icon: BrainCircuit, label: "Basic AI coaching responses", included: true },
  { icon: ShieldCheck, label: "Private & encrypted sessions", included: true },
  { icon: Mic, label: "Voice input", included: false },
  { icon: BarChart2, label: "Insights & analytics", included: false },
  { icon: ImagePlus, label: "Image & media uploads", included: false },
  { icon: BrainCircuit, label: "Cognitive pattern tracking", included: false },
  { icon: MessageCircle, label: "Unlimited messages", included: false },
];

const proFeatures = [
  { icon: MessageCircle, label: "Unlimited messages", included: true },
  { icon: BrainCircuit, label: "Advanced AI coaching (Gemini 2.5 Pro)", included: true },
  { icon: ShieldCheck, label: "Private & encrypted sessions", included: true },
  { icon: Mic, label: "Voice input & transcription", included: true },
  { icon: BarChart2, label: "Full insights & analytics dashboard", included: true },
  { icon: ImagePlus, label: "Image & media uploads", included: true },
  { icon: BrainCircuit, label: "Cognitive pattern & bias tracking", included: true },
  { icon: Zap, label: "Priority AI processing", included: true },
];

export default function PricingPage() {
  const { tier: currentTier, subscribe, openBillingPortal, billingLoading, billingError } = useDashboard();
  const [cycle, setCycle] = useState<BillingCycle>("annual");

  const monthlyPrice = cycle === "annual" ? 8.25 : 9.99;
  const annualTotal = 99;

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Back */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-8 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to dashboard
        </Link>

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 text-xs font-semibold mb-4">
            <Zap size={12} />
            Simple, transparent pricing
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">
            Invest in your mental clarity
          </h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
            Start free. Upgrade when you&apos;re ready for unlimited coaching, insights, and advanced features.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <button
            onClick={() => setCycle("monthly")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              cycle === "monthly"
                ? "bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setCycle("annual")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              cycle === "annual"
                ? "bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            Annual
            <span className="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700 px-1.5 py-0.5 rounded-full">
              Save $20
            </span>
          </button>
        </div>

        {billingError && (
          <p className="text-center text-sm text-red-600 dark:text-red-400 mb-6">{billingError}</p>
        )}

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Free card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex flex-col">
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-gray-600 mb-1">Free</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-extrabold text-gray-900 dark:text-white">$0</span>
                <span className="text-sm text-gray-400 mb-1.5">/month</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                5 messages per day — free forever
              </p>
            </div>

            {currentTier === "free" ? (
              <div className="mb-6 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-center text-sm font-semibold text-gray-500 dark:text-gray-400">
                Your current plan
              </div>
            ) : (
              <div className="mb-6 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-center text-sm font-semibold text-gray-400 dark:text-gray-600">
                Downgrade via billing portal
              </div>
            )}

            <ul className="space-y-2.5 flex-1">
              {freeFeatures.map(({ icon: Icon, label, included }) => (
                <li key={label} className="flex items-start gap-2.5">
                  {included ? (
                    <Check size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <X size={14} className="text-gray-300 dark:text-gray-700 shrink-0 mt-0.5" />
                  )}
                  <span className={`text-sm ${included ? "text-gray-700 dark:text-gray-300" : "text-gray-400 dark:text-gray-600"}`}>
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Pro card */}
          <div className="bg-gradient-to-br from-violet-600 to-brand-600 rounded-2xl p-[1.5px]">
            <div className="bg-white dark:bg-gray-900 rounded-[calc(1rem-1.5px)] p-6 flex flex-col h-full">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-violet-400">Pro</p>
                  <span className="text-[10px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700 px-2 py-0.5 rounded-full">
                    Most popular
                  </span>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-extrabold text-gray-900 dark:text-white">
                    ${monthlyPrice.toFixed(2)}
                  </span>
                  <span className="text-sm text-gray-400 mb-1.5">/month</span>
                </div>
                {cycle === "annual" ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    Billed annually — ${annualTotal}/yr (save $20.88)
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Billed monthly — cancel anytime
                  </p>
                )}
              </div>

              {currentTier === "pro" ? (
                <button
                  onClick={openBillingPortal}
                  disabled={billingLoading !== null}
                  className="mb-6 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-60 transition-colors"
                >
                  {billingLoading !== null ? <Loader2 size={14} className="animate-spin" /> : null}
                  Manage subscription
                </button>
              ) : (
                <button
                  onClick={() => subscribe(cycle)}
                  disabled={billingLoading !== null}
                  className="mb-6 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-brand-600 text-white text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-opacity shadow-lg shadow-violet-200 dark:shadow-violet-900/30"
                >
                  {billingLoading !== null ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  Upgrade to Pro — {cycle}
                </button>
              )}

              <ul className="space-y-2.5 flex-1">
                {proFeatures.map(({ icon: Icon, label, included }) => (
                  <li key={label} className="flex items-start gap-2.5">
                    <Check size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* FAQ strip */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { q: "Can I cancel anytime?", a: "Yes — cancel from the billing portal with one click. No questions asked." },
            { q: "Is my data private?", a: "Always. Your sessions are encrypted and never used to train shared models." },
            { q: "What payment methods?", a: "All major credit cards via Stripe. Invoices available on request." },
          ].map(({ q, a }) => (
            <div key={q} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{q}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{a}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-gray-400 dark:text-gray-600 mt-8">
          Secure payment via Stripe · Not a substitute for professional mental health treatment
        </p>
      </div>
    </div>
  );
}
