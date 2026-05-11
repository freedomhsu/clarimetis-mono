"use client";

import { Phone } from "lucide-react";
import { useI18n } from "@/components/providers/I18nContext";

/**
 * Compact persistent crisis footer — always visible at the bottom of the chat.
 * Not dismissible; a subtle reminder rather than an intrusive alert.
 */
export function CrisisBanner() {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-slate-50 dark:bg-[#0c0c18] border-t border-slate-200 dark:border-indigo-900/30 text-[11px] text-slate-400 dark:text-slate-500">
      <Phone size={11} className="shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      <span>
        In crisis?{" "}
        <strong className="text-slate-500 dark:text-slate-400">Call or text 988</strong>
        {" "}(US) ·{" "}
        <a
          href={t("crisis_url_href")}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          988lifeline.org
        </a>
      </span>
    </div>
  );
}

/**
 * Inline crisis alert — shown inside a message bubble when crisis_flagged=true.
 * Kept for backwards compatibility with MessageBubble tests.
 */
export function CrisisAlert() {
  const { t } = useI18n();
  return (
    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3 mb-3">
      <Phone className="text-red-500 shrink-0 mt-0.5" size={15} />
      <p className="text-sm text-red-700 dark:text-red-400">
        <strong className="text-red-800 dark:text-red-300">{t("crisis_title")}: </strong>
        {t("crisis_call")} <strong>{t("crisis_number")}</strong>{" "}
        {t("crisis_region")} ·{" "}
        <a href={t("crisis_url_href")} target="_blank" rel="noopener noreferrer" className="underline">
          {t("crisis_url")}
        </a>
      </p>
    </div>
  );
}
