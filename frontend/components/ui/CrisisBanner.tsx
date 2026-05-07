"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/components/providers/I18nContext";

export function CrisisBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { t } = useI18n();
  if (dismissed) return null;

  return (
    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3 mb-3">
      <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={17} />
      <div className="flex-1 text-sm">
        <p className="font-semibold text-red-800 dark:text-red-300">{t("crisis_title")}</p>
        <p className="text-red-700 dark:text-red-400 mt-0.5">
          {t("crisis_body")}{" "}
          <strong>{t("crisis_line_name")}</strong> — {t("crisis_call")}&nbsp;
          <strong>{t("crisis_number")}</strong> {t("crisis_region")}{" "}
          <a
            href={t("crisis_url_href")}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t("crisis_url")}
          </a>
          .
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-red-400 hover:text-red-600 dark:hover:text-red-300 shrink-0"
        aria-label={t("crisis_dismiss")}
      >
        <X size={15} />
      </button>
    </div>
  );
}
