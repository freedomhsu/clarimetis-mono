"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Next.js App Router error boundary for the dashboard segment.
 * Catches render and data-fetching errors thrown inside (dashboard)/ routes.
 */
export default function DashboardError({ error, reset }: Props) {
  useEffect(() => {
    // Log to your error reporting service here (e.g. Sentry.captureException(error))
    console.error("[Dashboard error]", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center min-h-screen bg-gray-950 px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <AlertTriangle className="text-red-400" size={32} />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            An unexpected error occurred. This has been logged and we&apos;ll look into it.
          </p>
          {error.digest && (
            <p className="text-xs text-gray-600 font-mono">Error ID: {error.digest}</p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw size={15} />
            Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 text-sm font-medium transition-colors"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
