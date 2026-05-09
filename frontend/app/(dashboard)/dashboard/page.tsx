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
  Brain,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { useDashboard } from "@/components/providers/DashboardContext";
import { useI18n } from "@/components/providers/I18nContext";

function DashboardContent() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { t } = useI18n();
  const firstName = user?.firstName ?? "there";
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? t("greeting_morning") : h < 18 ? t("greeting_afternoon") : t("greeting_evening"));
  }, [t]);

  const primaryActions = [
    {
      href: "/chat",
      icon: MessageCircle,
      label: t("action_text_label"),
      description: t("action_text_desc"),
      gradient: "from-indigo-500 to-violet-600",
      shadow: "shadow-indigo-900/30",
      badge: null,
    },
    {
      href: "/chat",
      icon: Mic,
      label: t("action_voice_label"),
      description: t("action_voice_desc"),
      gradient: "from-violet-500 to-purple-600",
      shadow: "shadow-violet-900/30",
      badge: "Pro",
    },
    {
      href: "/insights",
      icon: BarChart2,
      label: t("action_insights_label"),
      description: t("action_insights_desc"),
      gradient: "from-indigo-600 to-blue-700",
      shadow: "shadow-indigo-900/30",
      badge: "Pro",
    },
  ];

  const secondaryActions: {
    href: string;
    icon: React.ElementType;
    label: string;
    description: string;
    isPlan?: boolean;
  }[] = [
    { href: "/chat",      icon: ImagePlus,  label: t("action_media_label"),   description: t("action_media_desc") },
    { href: "/chat",      icon: History,    label: t("action_history_label"), description: t("action_history_desc") },
    { href: "/dashboard", icon: CreditCard, label: t("action_plan_label"),    description: t("action_plan_desc"), isPlan: true },
    { href: "/dashboard", icon: Settings,   label: t("action_settings_label"),description: t("action_settings_desc") },
  ];

  const highlights = [
    { icon: Flame, label: t("stat_streak"),   value: "—" },
    { icon: Star,  label: t("stat_sessions"), value: "—" },
    { icon: Clock, label: t("stat_week"),     value: "—" },
  ];
  const searchParams = useSearchParams();
  const { tier, loadTier } = useDashboard();
  // "pendingUpgrade" means the user came back from Stripe checkout and we are
  // waiting for the webhook to be reflected in /users/me.  The success banner
  // is only shown once polling actually confirms tier === "pro".
  const [pendingUpgrade, setPendingUpgrade] = useState(false);
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollActiveRef = useRef(false); // guard against concurrent loadTier calls
  // Keep a stable ref to loadTier so the timeout closure never goes stale.
  const loadTierRef = useRef(loadTier);
  useEffect(() => { loadTierRef.current = loadTier; }, [loadTier]);

  useEffect(() => {
    if (searchParams.get("upgrade") === "success") {
      setPendingUpgrade(true);
      // Remove query param from URL without triggering navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("upgrade");
      url.searchParams.delete("plan");
      window.history.replaceState({}, "", url.pathname);

      // Use a recursive setTimeout instead of setInterval so the next poll
      // only starts after the previous loadTier() call fully completes —
      // prevents concurrent in-flight requests from racing on setTier.
      const deadline = Date.now() + 60_000;

      async function poll() {
        if (pollActiveRef.current) return;
        pollActiveRef.current = true;
        try {
          await loadTierRef.current();
        } finally {
          pollActiveRef.current = false;
        }
        // Schedule next tick only if still within the deadline
        if (Date.now() < deadline) {
          pollRef.current = setTimeout(poll, 2_000);
        } else {
          pollRef.current = null;
        }
      }

      poll();
    }
    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Show the success banner and stop polling once tier is confirmed as pro.
  useEffect(() => {
    if (pendingUpgrade && tier === "pro") {
      setShowUpgradeSuccess(true);
      setPendingUpgrade(false);
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [tier, pendingUpgrade]);

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
    <div className="h-full min-h-screen overflow-y-auto bg-slate-50 dark:bg-[#080810]">
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-12 space-y-8">

        {/* Upgrade success banner */}
        {showUpgradeSuccess && (
          <div className="flex items-start gap-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t("dashboard_pro_success_title")}</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                {t("dashboard_pro_success_body")}
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

        {/* ── Header panel ── */}
        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#0c0c18] border border-indigo-900/40 shadow-xl">
          {/* Ambient depth */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 left-0 w-40 h-full bg-gradient-to-r from-indigo-600/[0.07] to-transparent" />
            <div className="absolute -top-2 left-10 w-24 h-10 rounded-full bg-indigo-500/10 blur-2xl" />
            <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-violet-600/[0.05] to-transparent" />
          </div>

          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 px-8 pt-7 pb-6">
            {/* Left: greeting */}
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="relative shrink-0">
                  <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-indigo-500/35 to-violet-600/35 blur-lg" />
                  <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/30 ring-1 ring-white/[0.12]">
                    <Brain size={16} className="text-white" />
                  </div>
                </div>
                <p className="text-sm font-semibold bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent">
                  {greeting}
                </p>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                {firstName} 👋
              </h1>
              <p className="mt-1 text-slate-500 dark:text-slate-400 text-sm">
                {t("dashboard_subtitle")}
              </p>
            </div>

            {/* Right: stat chips */}
            <div className="flex gap-3 shrink-0">
              {highlights.map(({ icon: Icon, label, value }) => (
                <div
                  key={label}
                  className="flex flex-col items-center bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/50 rounded-xl px-4 py-3 min-w-[76px]"
                >
                  <Icon size={15} className="text-indigo-500 dark:text-indigo-400" />
                  <span className="text-lg font-bold text-slate-900 dark:text-white leading-tight mt-0.5">
                    {value}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 text-center leading-tight mt-0.5">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Gradient border bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 dark:via-indigo-500/30 to-transparent" />
        </div>

        {/* ── Primary actions ── */}
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 mb-4">
            {t("dashboard_start_session")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {primaryActions.map(({ href, icon: Icon, label, description, gradient, shadow, badge }) => (
              <Link
                key={label}
                href={href}
                className={`group relative block rounded-2xl p-6 bg-gradient-to-br ${gradient} shadow-xl ${shadow} hover:scale-[1.02] active:scale-[0.99] transition-transform ring-1 ring-white/[0.10]`}
              >
                {badge && (
                  <span className="absolute top-4 right-4 text-[9px] font-bold uppercase tracking-widest bg-white/20 text-white px-2 py-0.5 rounded-full border border-white/20">
                    {badge}
                  </span>
                )}
                <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center mb-4 ring-1 ring-white/20">
                  <Icon size={22} className="text-white" />
                </div>
                <h3 className="font-bold text-white text-[15px] mb-1 tracking-tight">{label}</h3>
                <p className="text-sm text-white/70 leading-relaxed">{description}</p>
                <ArrowRight
                  size={15}
                  className="absolute bottom-5 right-5 text-white/40 group-hover:text-white group-hover:translate-x-0.5 transition-all"
                />
              </Link>
            ))}
          </div>
        </div>

        {/* ── Quick actions ── */}
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 mb-4">
            {t("dashboard_quick_actions")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {secondaryActions.map(({ href, icon: Icon, label, description, isPlan }) => {
              const cardBase = "flex flex-col gap-3 bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 rounded-2xl p-4 hover:border-indigo-300 dark:hover:border-indigo-700/60 hover:shadow-sm transition-all";
              if (isPlan) {
                return (
                  <button
                    key={label}
                    onClick={() => { setPlanError(null); setUpgradeOpen((v) => !v); }}
                    className={`${cardBase} text-left`}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50">
                      <Icon size={16} className="text-indigo-500 dark:text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {tier === "pro" ? t("action_plan_desc_pro") : description}
                      </p>
                    </div>
                  </button>
                );
              }
              return (
                <Link
                  key={label}
                  href={href}
                  className={cardBase}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50">
                    <Icon size={16} className="text-indigo-500 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{description}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Inline upgrade / billing panel */}
          {upgradeOpen && (
            <div className="relative mt-4 rounded-2xl overflow-hidden border border-indigo-100 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-950/40 p-5">
              <div className="pointer-events-none absolute top-0 right-0 w-24 h-full bg-gradient-to-l from-violet-500/10 to-transparent" />
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-indigo-900 dark:text-indigo-200">
                      {tier === "pro" ? "Manage Billing" : "Unlock Pro"}
                    </p>
                    <p className="text-[11px] text-indigo-600 dark:text-indigo-400">
                      {tier === "pro"
                        ? "View invoices, update payment or cancel."
                        : "Unlimited messages, voice, insights & more."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setUpgradeOpen(false); setPlanError(null); }}
                  className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 shrink-0"
                >
                  <X size={15} />
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
                      className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-sm font-semibold disabled:opacity-60 transition-all shadow-md shadow-indigo-900/20 ring-1 ring-white/[0.10]"
                    >
                      <span>7-day Free Trial</span>
                      <span className="flex items-center gap-1">
                        {planLoading === "monthly" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <span className="font-bold text-[11px] font-normal opacity-80">then $9.99/mo</span>
                        )}
                      </span>
                    </button>

                    <button
                      onClick={() => handleSubscribe("annual")}
                      disabled={planLoading !== null}
                      className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-400 hover:to-purple-500 text-white text-sm font-semibold disabled:opacity-60 transition-all shadow-md shadow-violet-900/20 ring-1 ring-white/[0.10]"
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
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-white dark:bg-[#13131f] text-indigo-700 dark:text-indigo-300 text-sm font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950/60 disabled:opacity-60 transition-colors"
                >
                  {planLoading === "portal" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} className="text-indigo-400" />
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
