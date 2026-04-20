"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Root-level error boundary — catches errors that escape the (dashboard) segment,
 * such as errors in the root layout or auth pages.
 */
export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error("[Global error]", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased flex items-center justify-center min-h-screen px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="text-red-400" size={32} />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
            <p className="text-sm text-gray-400 leading-relaxed">
              An unexpected error occurred. Please reload the page.
            </p>
            {error.digest && (
              <p className="text-xs text-gray-600 font-mono">Error ID: {error.digest}</p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              <RefreshCw size={15} />
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
