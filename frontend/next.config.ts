import type { NextConfig } from "next";

// Derive the API origin at build/start time so the CSP allows cross-origin
// requests to the backend (e.g. Cloud Run in production).
const rawApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
let apiOrigin = rawApiUrl;
try {
  apiOrigin = new URL(rawApiUrl).origin;
} catch {
  // If the value isn't a valid URL, include it as-is.
}

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {},
  transpilePackages: ["@clerk/nextjs", "@clerk/clerk-react", "@clerk/shared"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Disallow framing by other origins (clickjacking protection)
          { key: "X-Frame-Options", value: "DENY" },
          // Limit referrer information sent to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Grant microphone only to self (voice recording); deny camera/geo
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
          // HSTS — force HTTPS for 2 years (only effective in production)
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Content-Security-Policy
          // Note: 'unsafe-inline' for scripts is required by Clerk and Next.js
          // hydration. Migrate to nonce-based CSP when Clerk supports it.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.accounts.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://storage.googleapis.com https://img.clerk.com",
              "font-src 'self' data:",
              `connect-src 'self' ${apiOrigin} https://*.clerk.accounts.dev wss://*.clerk.accounts.dev https://clerk-telemetry.com`,
              "frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev",
              "media-src 'self' blob:",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
