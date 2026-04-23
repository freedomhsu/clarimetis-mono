"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

/**
 * On iOS Safari the PWA install flow is manual:
 *   Share → Add to Home Screen
 * This banner detects that situation and prompts the user.
 *
 * On Android / desktop Chrome the `beforeinstallprompt` event fires — we
 * capture it and show a one-click install button instead.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallBanner() {
  const [iosPrompt, setIosPrompt] = useState(false);
  const [nativePrompt, setNativePrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already installed (running in standalone mode)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
    if (isStandalone) { console.log("[PWA banner] skipped: already standalone"); return; }

    if (sessionStorage.getItem("pwa-banner-dismissed")) { console.log("[PWA banner] skipped: dismissed"); return; }

    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !/crios|fxios/i.test(navigator.userAgent);
    if (isIos) { console.log("[PWA banner] iOS prompt shown"); setIosPrompt(true); return; }

    const w = window as Window & { __pwaInstallPrompt?: BeforeInstallPromptEvent | null };
    console.log("[PWA banner] __pwaInstallPrompt =", w.__pwaInstallPrompt);
    if (w.__pwaInstallPrompt) {
      setNativePrompt(w.__pwaInstallPrompt);
      console.log("[PWA banner] native prompt set from window");
      return;
    }
    function handleReady() {
      console.log("[PWA banner] pwaInstallReady event received, prompt =", w.__pwaInstallPrompt);
      if (w.__pwaInstallPrompt) setNativePrompt(w.__pwaInstallPrompt);
    }
    window.addEventListener("pwaInstallReady", handleReady);
    return () => window.removeEventListener("pwaInstallReady", handleReady);
  }, []);

  function dismiss() {
    sessionStorage.setItem("pwa-banner-dismissed", "1");
    setDismissed(true);
    setIosPrompt(false);
    setNativePrompt(null);
  }

  async function handleNativeInstall() {
    if (!nativePrompt) return;
    await nativePrompt.prompt();
    const { outcome } = await nativePrompt.userChoice;
    if (outcome === "accepted") setNativePrompt(null);
  }

  if (dismissed || (!iosPrompt && !nativePrompt)) return null;

  return (
    <div
      role="banner"
      className="fixed bottom-0 inset-x-0 z-50 px-4 pb-safe-area-inset-bottom"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
    >
      <div className="max-w-lg mx-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 p-4 flex items-start gap-3">
        {/* Icon */}
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center shrink-0">
          <svg width="22" height="22" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 9a7 7 0 1 0 14 0A7 7 0 0 0 2 9zm7-3.5a.75.75 0 0 1 .75.75v2h2a.75.75 0 0 1 0 1.5h-2v2a.75.75 0 0 1-1.5 0v-2h-2a.75.75 0 0 1 0-1.5h2v-2A.75.75 0 0 1 9 5.5z" fill="white"/>
          </svg>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-snug">
            Add ClariMetis to your home screen
          </p>
          {iosPrompt ? (
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              Tap <Share size={11} className="inline -mt-0.5" /> then{" "}
              <strong className="text-gray-300">Add to Home Screen</strong> for the full app experience.
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">
              Install for faster access and offline support.
            </p>
          )}

          {nativePrompt && (
            <button
              type="button"
              onClick={handleNativeInstall}
              className="mt-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-brand-500 to-violet-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              Install app
            </button>
          )}
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install banner"
          className="text-gray-500 hover:text-gray-300 transition-colors mt-0.5 shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
