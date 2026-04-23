import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { PWAInstallBanner } from "@/components/ui/PWAInstallBanner";
import { SWUpdateBanner } from "@/components/ui/SWUpdateBanner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ClariMetis",
  description: "Your personal AI life coaching companion",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "ClariMetis",
    startupImage: "/icons/icon-512.png",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#0ea5e9",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body className={`${inter.className} bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 antialiased`}>
          {children}
          <PWAInstallBanner />
          <SWUpdateBanner />
          <script
            dangerouslySetInnerHTML={{
              __html: `
                window.__pwaInstallPrompt = null;
                window.__swWaiting = null;

                function notifySwUpdate(sw) {
                  window.__swWaiting = sw;
                  window.dispatchEvent(new Event('swUpdateReady'));
                }

                if ('serviceWorker' in navigator) {
                  // Reload page when a new SW takes control (after user taps Update).
                  var refreshing = false;
                  navigator.serviceWorker.addEventListener('controllerchange', function() {
                    if (refreshing) return;
                    refreshing = true;
                    window.location.reload();
                  });

                  navigator.serviceWorker.register('/sw.js').then(function(reg) {
                    // Already a waiting SW on first load?
                    if (reg.waiting && navigator.serviceWorker.controller) {
                      notifySwUpdate(reg.waiting);
                    }
                    // New SW found while page is open.
                    reg.addEventListener('updatefound', function() {
                      var newWorker = reg.installing;
                      newWorker.addEventListener('statechange', function() {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                          notifySwUpdate(newWorker);
                        }
                      });
                    });
                  });
                }

                window.addEventListener('beforeinstallprompt', function(e) {
                  e.preventDefault();
                  window.__pwaInstallPrompt = e;
                  window.dispatchEvent(new Event('pwaInstallReady'));
                });
              `,
            }}
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
