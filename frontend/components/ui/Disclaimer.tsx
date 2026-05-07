"use client";

import { useI18n } from "@/components/providers/I18nContext";

export function Disclaimer() {
  const { t } = useI18n();
  return (
    <p className="text-xs text-gray-400 text-center py-1.5">
      {t("disclaimer")}
    </p>
  );
}
