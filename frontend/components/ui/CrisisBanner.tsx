"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

export function CrisisBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3 mb-3">
      <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={17} />
      <div className="flex-1 text-sm">
        <p className="font-semibold text-red-800 dark:text-red-300">Important</p>
        <p className="text-red-700 dark:text-red-400 mt-0.5">
          If you&apos;re in crisis, please reach out immediately.{" "}
          <strong>988 Suicide &amp; Crisis Lifeline</strong> — call or text&nbsp;
          <strong>988</strong> (US) or chat at{" "}
          <a
            href="https://988lifeline.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            988lifeline.org
          </a>
          .
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-red-400 hover:text-red-600 dark:hover:text-red-300 shrink-0"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  );
}
