"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { SidebarUserMenu } from "@/components/auth/SidebarUserMenu";
import {
  BarChart2,
  Home,
  Images,
  MessageCircle,
  Mic,
  Settings,
  Zap,
  Lock,
  ArrowUpRight,
  Sparkles,
  Globe,
  Check,
  X,
} from "lucide-react";
import { useDashboard } from "@/components/providers/DashboardContext";
import { useI18n } from "@/components/providers/I18nContext";
import type { Lang } from "@/lib/i18n";

const LANGUAGES: { code: Lang; label: string; flag: string }[] = [
  { code: "en",    label: "English",   flag: "🇺🇸" },
  { code: "es",    label: "Español",   flag: "🇪🇸" },
  { code: "pt",    label: "Português", flag: "🇧🇷" },
  { code: "fr",    label: "Français",  flag: "🇫🇷" },  { code: "it",    label: "Italiano",  flag: "🇮🇹" },  { code: "zh-TW", label: "繁體中文",  flag: "�" },
  { code: "ja",    label: "日本語",    flag: "🇯🇵" },
  { code: "ko",    label: "한국어",    flag: "🇰🇷" },
];

function LanguagePicker() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(code: Lang) {
    if (code === lang) return;
    setLang(code);
    setOpen(false);
  }

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div ref={ref} className="relative px-3 pb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-indigo-900/40 bg-slate-50 dark:bg-[#16162a] hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors text-left"
        aria-label="Change AI language"
        aria-expanded={open}
      >
        <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 bg-slate-100 dark:bg-[#13131f] border border-slate-200 dark:border-white/[0.04]">
          <Globe size={13} className="text-slate-400 dark:text-slate-600" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 leading-none mb-0.5">{t("ai_language")}</span>
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-300">
            <span>{current.flag}</span>
            <span>{current.label}</span>
          </span>
        </span>
        <span className={`text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <svg viewBox="0 0 10 6" width="10" height="6" fill="none">
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/50 rounded-xl shadow-xl shadow-black/20 overflow-hidden z-50">
          {LANGUAGES.map((entry) => (
            <button
              key={entry.code}
              type="button"
              onClick={() => select(entry.code)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                entry.code === lang
                  ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
                  : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#16162a]"
              }`}
            >
              <span className="text-base leading-none shrink-0">{entry.flag}</span>
              <span className="flex-1 text-left text-[13px] font-medium">{entry.label}</span>
              {entry.code === lang && <Check size={13} className="text-indigo-500 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function DashboardSidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { tier, openBillingPortal } = useDashboard();
  const { t } = useI18n();

  const navLinks = [
    { href: "/dashboard", label: t("nav_dashboard"), icon: Home,          badge: null  },
    { href: "/chat",      label: t("nav_chat"),       icon: MessageCircle, badge: null  },
    { href: "/insights",  label: t("nav_insights"),   icon: BarChart2,     badge: "Pro" },
    { href: "/media",     label: t("nav_media"),      icon: Images,        badge: "Pro" },
    { href: "/pricing",   label: t("nav_pricing"),    icon: Zap,           badge: null  },
  ];

  const utilityLinks = [
    { href: "/voice",   label: t("nav_voice"),   icon: Mic,      badge: "Pro" },
    { href: "/account", label: t("nav_account"), icon: Settings, badge: null  },
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-64 flex flex-col bg-white dark:bg-[#0c0c18] border-r border-slate-200 dark:border-white/[0.05] transition-transform duration-300 ease-in-out md:relative md:inset-auto md:z-auto md:translate-x-0 md:shrink-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Mobile close button */}
      <button
        type="button"
        onClick={onMobileClose}
        className="absolute top-3.5 right-3.5 flex md:hidden items-center justify-center w-9 h-9 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors touch-manipulation"
        aria-label="Close navigation"
      >
        <X size={18} />
      </button>

      {/* ── Brand header ── */}
      <div className="relative overflow-hidden px-5 py-5 shrink-0">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 w-28 h-full bg-gradient-to-r from-indigo-600/[0.07] to-transparent" />
          <div className="absolute -top-2 left-8 w-16 h-8 rounded-full bg-indigo-500/10 blur-2xl" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 dark:via-indigo-500/30 to-transparent" />
        <div className="relative flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-indigo-500/35 to-violet-600/35 blur-lg" />
            <div className="relative w-9 h-9 rounded-xl overflow-hidden shadow-lg shadow-indigo-900/30 ring-1 ring-white/[0.12]">
              <Image
                src="/icons/icon-96.png"
                alt="ClariMetis"
                width={36}
                height={36}
                className="object-cover"
                priority
              />
            </div>
          </div>
          <div>
            <p className="text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">ClariMetis</p>
            <p className="text-[10px] font-medium bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent leading-tight">
              AI Life Coach
            </p>
          </div>
        </div>
      </div>

      {/* ── Main nav (scrollable) ── */}
      {/* min-h-0 is required so flex-1 can actually shrink in a flex column */}
      <nav className="flex-1 min-h-0 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 px-2 mb-2">
          {t("nav_section")}
        </p>
        {navLinks.map(({ href, label, icon: Icon, badge }) => {
          const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onMobileClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                isActive
                  ? "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200/70 dark:border-indigo-800/50 text-indigo-900 dark:text-indigo-200 shadow-sm"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#13131f] hover:border-slate-200 dark:hover:border-indigo-900/40 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                isActive
                  ? "bg-indigo-100 dark:bg-indigo-900/60 border border-indigo-200/60 dark:border-indigo-800/50"
                  : "bg-slate-100 dark:bg-[#13131f] border border-slate-200 dark:border-white/[0.05]"
              }`}>
                <Icon size={14} className={isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
              </span>
              {label}
              {badge && !isActive && (
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wide bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 text-indigo-500 dark:text-indigo-400 px-1.5 py-0.5 rounded-md">
                  {badge}
                </span>
              )}
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Utility links — always visible, never scrolls away ── */}
      <div className="shrink-0 px-3 pt-2 pb-1 border-t border-slate-100 dark:border-white/[0.05] space-y-0.5">
        {utilityLinks.map(({ href, label, icon: Icon, badge }) => {
          const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={label}
              href={href}
              onClick={onMobileClose}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                isActive
                  ? "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200/70 dark:border-indigo-800/50 text-indigo-900 dark:text-indigo-200"
                  : "border-transparent text-slate-500 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-[#13131f] hover:border-slate-200 dark:hover:border-indigo-900/40 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                isActive
                  ? "bg-indigo-100 dark:bg-indigo-900/60 border border-indigo-200/60 dark:border-indigo-800/50"
                  : "bg-slate-100 dark:bg-[#16162a] border border-slate-200 dark:border-white/[0.04]"
              }`}>
                <Icon size={13} className={isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-600"} />
              </span>
              <span className="text-[13px]">{label}</span>
              {badge && !isActive && (
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wide bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 text-indigo-500 dark:text-indigo-400 px-1.5 py-0.5 rounded-md">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* ── Language picker ── */}
      <LanguagePicker />

      {/* ── Plan status ── */}
      {tier === "free" ? (
        <div className="relative mx-3 my-2 rounded-xl overflow-hidden shrink-0">
          {/* Gradient border via wrapper */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-600/20 p-px">
            <div className="h-full w-full rounded-xl bg-indigo-50/80 dark:bg-[#0e0e1c]" />
          </div>

          <div className="relative px-3 pt-3 pb-2.5">
            {/* Ambient glow */}
            <div className="pointer-events-none absolute top-0 right-0 w-20 h-full bg-gradient-to-l from-violet-500/10 to-transparent rounded-xl" />
            <div className="pointer-events-none absolute -top-4 right-3 w-14 h-10 rounded-full bg-violet-400/10 blur-2xl" />

            {/* Header row */}
            <div className="relative flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shadow-indigo-900/20">
                  <Sparkles size={8} className="text-white" />
                </div>
                <span className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300 tracking-tight">{t("plan_free")}</span>
              </div>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 border border-indigo-200/60 dark:border-indigo-700/50 text-indigo-500 dark:text-indigo-400">
                {t("plan_free_limit")}
              </span>
            </div>

            {/* Divider */}
            <div className="relative h-px bg-gradient-to-r from-transparent via-indigo-300/40 dark:via-indigo-700/40 to-transparent mb-2" />

            {/* Locked feature pills */}
            <p className="relative text-[9px] font-semibold uppercase tracking-widest text-indigo-400/80 dark:text-indigo-600 mb-1.5">
              {t("plan_pro_unlocks")}
            </p>
            <div className="relative flex flex-wrap gap-1 mb-2.5">
              {([
                "plan_feature_unlimited",
                "plan_feature_voice",
                "plan_feature_ai",
                "plan_feature_insights",
              ] as const).map((key) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-indigo-100/80 dark:bg-indigo-900/40 border border-indigo-200/50 dark:border-indigo-800/40 text-indigo-500 dark:text-indigo-500"
                >
                  <Lock size={6} className="shrink-0" />
                  {t(key)}
                </span>
              ))}
            </div>

            {/* CTA */}
            <Link
              href="/pricing"
              className="relative flex items-center justify-between w-full px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-[11px] font-bold transition-all shadow-md shadow-indigo-900/25 ring-1 ring-white/[0.12] group"
            >
              <span>{t("plan_upgrade_cta")}</span>
              <ArrowUpRight size={12} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="relative mx-3 my-2 rounded-xl overflow-hidden shrink-0">
          {/* Gradient border */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-500/40 to-violet-600/30 p-px">
            <div className="h-full w-full rounded-xl bg-indigo-50/90 dark:bg-[#0e0e1c]" />
          </div>

          <div className="relative px-3 pt-3 pb-2.5">
            {/* Ambient glow */}
            <div className="pointer-events-none absolute top-0 right-0 w-20 h-full bg-gradient-to-l from-violet-500/10 to-transparent rounded-xl" />
            <div className="pointer-events-none absolute -top-4 right-3 w-14 h-10 rounded-full bg-indigo-400/10 blur-2xl" />

            {/* Header */}
            <div className="relative flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shadow-indigo-900/20">
                  <Sparkles size={8} className="text-white" />
                </div>
                <span className="text-[11px] font-bold bg-gradient-to-r from-indigo-600 to-violet-600 dark:from-indigo-300 dark:to-violet-300 bg-clip-text text-transparent tracking-tight">
                  {t("plan_pro")}
                </span>
              </div>
              <span className="flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/60" />
                <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">{t("plan_active")}</span>
              </span>
            </div>

            {/* Divider */}
            <div className="relative h-px bg-gradient-to-r from-transparent via-indigo-300/40 dark:via-indigo-700/40 to-transparent mb-2" />

            {/* Feature list */}
            <div className="relative flex flex-wrap gap-1 mb-2.5">
              {([
                "plan_feature_unlimited",
                "plan_feature_voice",
                "plan_feature_ai",
                "plan_feature_insights",
                "plan_feature_memory",
                "plan_feature_analytics",
              ] as const).map((key) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-indigo-100/80 dark:bg-indigo-900/40 border border-indigo-200/50 dark:border-indigo-800/40 text-indigo-600 dark:text-indigo-400"
                >
                  <svg viewBox="0 0 8 8" className="w-2 h-2 shrink-0" fill="none">
                    <polyline points="1,4.5 3,6.5 7,1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t(key)}
                </span>
              ))}
            </div>

            {/* Manage / cancel billing */}
            <button
              onClick={openBillingPortal}
              className="relative w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-indigo-200/60 dark:border-indigo-800/50 bg-white/60 dark:bg-[#13131f]/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold transition-colors group"
            >
              <span>{t("plan_manage_billing")}</span>
              <ArrowUpRight size={10} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── User ── */}
      <div className="shrink-0 px-3 pb-3 pt-1 border-t border-slate-100 dark:border-white/[0.05]">
        <SidebarUserMenu />
      </div>
    </aside>
  );
}

