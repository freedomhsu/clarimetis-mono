"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

export function SWUpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    // The inline script in layout.tsx populates window.__swWaiting and fires
    // the 'swUpdateReady' event before React hydrates, so we check both here.
    const stored = (window as Window & { __swWaiting?: ServiceWorker }).__swWaiting;
    if (stored) {
      setWaiting(stored);
    }

    const handler = () => {
      const sw = (window as Window & { __swWaiting?: ServiceWorker }).__swWaiting;
      if (sw) setWaiting(sw);
    };
    window.addEventListener("swUpdateReady", handler);
    return () => window.removeEventListener("swUpdateReady", handler);
  }, []);

  if (!waiting) return null;

  const handleUpdate = () => {
    waiting.postMessage({ type: "SKIP_WAITING" });
    // controllerchange listener in layout.tsx will reload the page
  };

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[9999] flex items-center justify-between gap-3 px-4 py-3 bg-sky-600 text-white text-sm shadow-lg"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
    >
      <span className="font-medium">A new version is available.</span>
      <button
        onClick={handleUpdate}
        className="flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg bg-white text-sky-700 font-semibold text-xs hover:bg-sky-50 transition-colors"
      >
        <RefreshCw size={12} />
        Update now
      </button>
    </div>
  );
}
