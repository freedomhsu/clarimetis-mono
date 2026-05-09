"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import DashboardSidebar from "./DashboardSidebar";
import { DashboardProvider } from "@/components/providers/DashboardContext";
import { I18nProvider } from "@/components/providers/I18nContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <I18nProvider>
      <DashboardProvider>
        <div className="flex h-dvh bg-gray-50 dark:bg-gray-950 overflow-hidden">
          {/* Mobile top bar — hidden on md+ */}
          <div className="fixed top-0 left-0 right-0 h-14 z-30 flex items-center px-4 gap-3 bg-white dark:bg-[#0c0c18] border-b border-slate-200 dark:border-white/[0.05] md:hidden">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#13131f] text-slate-600 dark:text-slate-400 touch-manipulation"
              aria-label="Open navigation"
            >
              <Menu size={18} />
            </button>
            <span className="text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-white">ClariMetis</span>
          </div>

          {/* Sidebar backdrop — mobile only */}
          {mobileSidebarOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              aria-hidden="true"
              onClick={() => setMobileSidebarOpen(false)}
            />
          )}

          <DashboardSidebar
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />

          {/* pt-14 on mobile reserves space for the fixed top bar */}
          <main className="flex-1 overflow-hidden pt-14 md:pt-0">{children}</main>
        </div>
      </DashboardProvider>
    </I18nProvider>
  );
}

