"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { SidebarUserMenu } from "@/components/auth/SidebarUserMenu";
import {
  BarChart2,
  Home,
  MessageCircle,
  Mic,
  Settings,
  Sparkles,
  Zap,
  Lock,
  ArrowUpRight,
} from "lucide-react";
import { useDashboard } from "@/components/providers/DashboardContext";

const navLinks = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: Home,
    iconBg: "bg-sky-100 dark:bg-sky-900/40",
    iconColor: "text-sky-600 dark:text-sky-400",
    activeBg: "bg-sky-50 dark:bg-sky-900/20",
    activeBorder: "border-sky-200 dark:border-sky-800",
    activeText: "text-sky-700 dark:text-sky-300",
  },
  {
    href: "/chat",
    label: "Coaching Chat",
    icon: MessageCircle,
    iconBg: "bg-violet-100 dark:bg-violet-900/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    activeBg: "bg-violet-50 dark:bg-violet-900/20",
    activeBorder: "border-violet-200 dark:border-violet-800",
    activeText: "text-violet-700 dark:text-violet-300",
  },
  {
    href: "/insights",
    label: "Insights",
    icon: BarChart2,
    badge: "Pro",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    activeBg: "bg-emerald-50 dark:bg-emerald-900/20",
    activeBorder: "border-emerald-200 dark:border-emerald-800",
    activeText: "text-emerald-700 dark:text-emerald-300",
  },
  {
    href: "/pricing",
    label: "Pricing",
    icon: Zap,
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    activeBg: "bg-amber-50 dark:bg-amber-900/20",
    activeBorder: "border-amber-200 dark:border-amber-800",
    activeText: "text-amber-700 dark:text-amber-300",
  },
];

const bottomLinks = [
  {
    href: "/chat",
    label: "Voice Session",
    icon: Mic,
    badge: "Pro",
    iconColor: "text-pink-600 dark:text-pink-400",
    iconBg: "bg-pink-50 dark:bg-pink-900/30",
  },
  {
    href: "/dashboard",
    label: "Settings",
    icon: Settings,
    badge: null,
    iconColor: "text-gray-500 dark:text-gray-400",
    iconBg: "bg-gray-100 dark:bg-gray-800",
  },
];

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { tier } = useDashboard();

  return (
    <aside className="w-64 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">

      {/* Logo / brand */}
      <div className="px-5 py-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center shrink-0 shadow-md shadow-brand-200 dark:shadow-brand-900/30">
            <MessageCircle size={17} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-gray-900 dark:text-white leading-tight">ClariMetis</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">AI Wellness Coach</p>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600 px-2 mb-2">
          Navigation
        </p>
        {navLinks.map(({ href, label, icon: Icon, badge, iconBg, iconColor, activeBg, activeBorder, activeText }) => {
          const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                isActive
                  ? `${activeBg} ${activeBorder} ${activeText}`
                  : "border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100"
              }`}
            >
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isActive ? iconBg : "bg-gray-100 dark:bg-gray-800"}`}>
                <Icon size={15} className={isActive ? iconColor : "text-gray-400 dark:text-gray-500"} />
              </span>
              {label}
              {badge && !isActive && (
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wide bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-md">
                  {badge}
                </span>
              )}
              {isActive && (
                <span className={`ml-auto w-1.5 h-1.5 rounded-full ${iconColor.replace("text-", "bg-")}`} />
              )}
            </Link>
          );
        })}

        {/* Secondary links */}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600 px-2 mt-5 mb-2">
          More
        </p>
        {bottomLinks.map(({ href, label, icon: Icon, badge, iconColor, iconBg }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-all"
          >
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
              <Icon size={15} className={iconColor} />
            </span>
            {label}
            {badge && (
              <span className="ml-auto text-[9px] font-bold uppercase tracking-wide bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Plan status — always visible */}
      {tier === "free" ? (
        <div className="mx-3 mb-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Lock size={11} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
              Free plan · 5 messages/day
            </span>
          </div>
          <p className="text-[10px] text-amber-600 dark:text-amber-500 mb-2">
            Resets at midnight
          </p>
          <Link
            href="/pricing"
            className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold transition-colors"
          >
            <span>Upgrade to Pro</span>
            <ArrowUpRight size={12} />
          </Link>
        </div>
      ) : (
        <div className="mx-3 mb-3 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} className="text-violet-600 dark:text-violet-400 shrink-0" />
            <span className="text-[11px] font-bold text-violet-800 dark:text-violet-300">
              Pro plan · Unlimited
            </span>
          </div>
          <p className="text-[10px] text-violet-500 dark:text-violet-500 mt-0.5">
            All features unlocked
          </p>
        </div>
      )}

      {/* User */}
      <div className="p-4 border-t border-gray-100 dark:border-gray-800">
        <SidebarUserMenu />
      </div>
    </aside>
  );
}

