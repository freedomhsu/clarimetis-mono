"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import React from "react";
import { useSearchParams } from "next/navigation";
import { useUser, useAuth } from "@clerk/nextjs";
import {
  MessageCircle,
  Mic,
  BarChart2,
  ImagePlus,
  History,
  CreditCard,
  Settings,
  Flame,
  Star,
  Clock,
  AlertTriangle,
  ArrowRight,
  Loader2,
  X,
  CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useDashboard } from "@/components/providers/DashboardContext";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function useGreeting() {
  const [greeting, setGreeting] = useState("");
  useEffect(() => { setGreeting(getGreeting()); }, []);
  return greeting;
}

const primaryActions = [
  {
    href: "/chat",
    icon: MessageCircle,
    label: "Text Session",
    description: "Talk through what's on your mind with your AI coach",
    gradient: "from-sky-500 to-blue-600",
    shadow: "shadow-sky-200 dark:shadow-sky-900/40",
    badge: null,
  },
  {
    href: "/chat",
    icon: Mic,
    label: "Voice Session",
    description: "Speak naturally — your words are transcribed in real time",
    gradient: "from-violet-500 to-purple-600",
    shadow: "shadow-violet-200 dark:shadow-violet-900/40",
    badge: "Pro",
  },
  {
    href: "/insights",
    icon: BarChart2,
    label: "View Insights",
    description: "Explore patterns, cognitive trends & personalised focus areas",
    gradient: "from-emerald-500 to-teal-600",
    shadow: "shadow-emerald-200 dark:shadow-emerald-900/40",
    badge: "Pro",
  },
];

const secondaryActions: {
  href: string;
  icon: React.ElementType;
  label: string;
  description: string;
  iconBg: string;
  iconColor: string;
  isPlan?: boolean;
}[] = [
  {
    href: "/chat",
    icon: ImagePlus,
    label: "Upload Media",
    description: "Share images or documents",
    iconBg: "bg-orange-50 dark:bg-orange-900/30",
    iconColor: "text-orange-600 dark:text-orange-400",
  },
  {
    href: "/chat",
    icon: History,
    label: "Session History",
    description: "Review past conversations",
    iconBg: "bg-pink-50 dark:bg-pink-900/30",
    iconColor: "text-pink-600 dark:text-pink-400",
  },
  {
    href: "/dashboard",
    icon: CreditCard,
    label: "Manage Plan",
    description: "Upgrade or view billing",
    iconBg: "bg-amber-50 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
    isPlan: true,
  },
  {
    href: "/dashboard",
    icon: Settings,
    label: "Settings",
    description: "Preferences & account",
    iconBg: "bg-gray-100 dark:bg-gray-800",
    iconColor: "text-gray-600 dark:text-gray-400",
  },
];

const highlights = [
  { icon: Flame, label: "Day streak", value: "—", color: "text-orange-500" },
  { icon: Star, label: "Sessions total", value: "—", color: "text-violet-500" },
  { icon: Clock, label: "This week", value: "—", color: "text-sky-500" },
];

function DashboardContent() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const firstName = user?.firstName ?? "there";
  const greeting = useGreeting();
  const searchParams = useSearchParams();
  const { tier, loadTier } = useDashboard();
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep a stable ref to loadTier so the interval closure never goes stale.
  const loadTierRef = useRef(loadTier);
  useEffect(() => { loadTierRef.current = loadTier; }, [loadTier]);

  useEffect(() => {
    if (searchParams.get("upgrade") === "success") {
      setShowUpgradeSuccess(true);
      // Remove query param from URL without triggering navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("upgrade");
      url.searchParams.delete("plan");
      window.history.replaceState({}, "", url.pathname);

      // Fetch immediately — webhook may already be processed.
      loadTierRef.current();

      // Then poll every 2 s for up to 60 s to handle Stripe webhook latency.
      const deadline = Date.now() + 60_000;
      pollRef.current = setInterval(async () => {
        await loadTierRef.current();
        if (Date.now() >= deadline) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      }, 2_000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Stop polling once the tier has updated.
  useEffect(() => {
    if (tier === "pro" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [tier]);

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState<"monthly" | "annual" | "portal" | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const handleSubscribe = useCallback(
    async (plan: "monthly" | "annual") => {
      setPlanError(null);
      setPlanLoading(plan);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");
        const url = await api.getSubscribeUrl(token, plan);
        window.location.href = url;
      } catch {
        setPlanError("Could not start checkout. Please try again.");
        setPlanLoading(null);
      }
    },
    [getToken]
  );

  const handleBillingPortal = useCallback(async () => {
    setPlanError(null);
    setPlanLoading("portal");
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const url = await api.getBillingPortalUrl(token);
      window.location.href = url;
    } catch {
      setPlanError("Could not open billing portal. Please try again.");
      setPlanLoading(null);
    }
  }, [getToken]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">

        {/* Upgrade success banner */}
        {showUpgradeSuccess && (
          <div className="flex items-start gap-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">You&apos;re now on Pro!</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                Unlimited messages and all features are now unlocked. Welcome to the full experience.
              </p>
            </div>
            <button
              onClick={() => setShowUpgradeSuccess(false)}
              className="text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-200 text-lg leading-none shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand-600 dark:text-brand-400 mb-1">
              {greeting}
            </p>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {firstName} 👋
            </h1>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              What would you like to work on today?
            </p>
          </div>
          {/* Stat chips */}
          <div className="flex gap-3">
            {highlights.map(({ icon: Icon, label, value, color }) => (
              <div
                key={label}
                className="flex flex-col items-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-2.5 min-w-[72px]"
              >
                <Icon size={18} className={color} />
                <span className="text-lg font-bold text-gray-900 dark:text-white leading-tight mt-0.5">
                  {value}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 text-center leading-tight">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Primary actions */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4">
            Start a session
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {primaryActions.map(({ href, icon: Icon, label, description, gradient, shadow, badge }) => (
              <Link
                key={label}
                href={href}
                className={`group relative block rounded-2xl p-6 bg-gradient-to-br ${gradient} shadow-lg ${shadow} hover:scale-[1.02] active:scale-[0.99] transition-transform`}
              >
                {badge && (
                  <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-wide bg-white/20 text-white px-2 py-0.5 rounded-full">
                    {badge}
                  </span>
                )}
                <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center mb-4">
                  <Icon size={22} className="text-white" />
                </div>
                <h3 className="font-bold text-white text-lg mb-1">{label}</h3>
                <p className="text-sm text-white/75 leading-relaxed">{description}</p>
                <ArrowRight
                  size={16}
                  className="absolute bottom-5 right-5 text-white/50 group-hover:text-white group-hover:translate-x-0.5 transition-all"
                />
              </Link>
            ))}
          </div>
        </div>

        {/* Secondary actions */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4">
            Quick actions
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {secondaryActions.map(({ href, icon: Icon, label, description, iconBg, iconColor, isPlan }) => {
              if (isPlan) {
                return (
                  <button
                    key={label}
                    onClick={() => { setPlanError(null); setUpgradeOpen((v) => !v); }}
                    className="flex flex-col gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-sm transition-all text-left"
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
                      <Icon size={17} className={iconColor} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {tier === "pro" ? "View or cancel billing" : description}
                      </p>
                    </div>
                  </button>
                );
              }
              return (
                <Link
                  key={label}
                  href={href}
                  className="flex flex-col gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm transition-all"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
                    <Icon size={17} className={iconColor} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Inline upgrade / billing panel */}
          {upgradeOpen && (
            <div className="mt-4 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-bold text-gray-900 dark:text-white">
                    {tier === "pro" ? "Manage Billing" : "Upgrade to Pro"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {tier === "pro"
                      ? "View invoices, update payment method, or cancel your subscription."
                      : "Unlock unlimited messages, voice, insights & more."}
                  </p>
                </div>
                <button
                  onClick={() => { setUpgradeOpen(false); setPlanError(null); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X size={16} />
                </button>
              </div>

              {planError && (
                <p className="mb-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  {planError}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {tier !== "pro" && (
                  <>
                    <button
                      onClick={() => handleSubscribe("monthly")}
                      disabled={planLoading !== null}
                      className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 transition-colors"
                    >
                      <span>Pro Monthly</span>
                      <span className="flex items-center gap-1">
                        {planLoading === "monthly" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <span className="font-bold">$9.99/mo</span>
                        )}
                      </span>
                    </button>

                    <button
                      onClick={() => handleSubscribe("annual")}
                      disabled={planLoading !== null}
                      className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors"
                    >
                      <span>
                        Pro Annual
                        <span className="ml-1.5 text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full">Save $20</span>
                      </span>
                      <span className="flex items-center gap-1">
                        {planLoading === "annual" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <span className="font-bold">$99.99/yr</span>
                        )}
                      </span>
                    </button>
                  </>
                )}

                <button
                  onClick={handleBillingPortal}
                  disabled={planLoading !== null}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60 transition-colors"
                >
                  {planLoading === "portal" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} className="text-gray-400" />
                  )}
                  Manage Billing
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Crisis disclaimer */}
        <div className="flex gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
            <strong>Reminder:</strong> ClariMetis is an AI life coaching companion, not a
            licensed therapist or medical professional. If you are in crisis, call or text{" "}
            <strong>988</strong> (US — Suicide &amp; Crisis Lifeline).
          </p>
        </div>

      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
