import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/forgot-password(.*)",
  "/sso-callback(.*)",
  "/terms(.*)",
  "/privacy(.*)",
  "/manifest.json",
  "/sw.js",
  // Stripe webhooks are authenticated by Stripe's own signature, not Clerk.
  "/api/proxy/webhooks/(.*)",
]);

// Routes where an already-authenticated user should be bounced to /dashboard.
const isAuthOrHomeRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/forgot-password(.*)",
]);

/** Validate a redirect_url is same-origin and return the path+search+hash, or null. */
function safePath(raw: string | null, origin: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin === origin) return url.pathname + url.search + url.hash;
  } catch {
    // fall through
  }
  return raw.startsWith("/") ? raw : null;
}

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Authenticated user visiting the home page or an auth page — redirect
  // server-side before any client rendering, preserving any redirect_url param.
  if (userId && isAuthOrHomeRoute(req)) {
    const destination =
      safePath(req.nextUrl.searchParams.get("redirect_url"), req.nextUrl.origin) ?? "/dashboard";
    return NextResponse.redirect(new URL(destination, req.nextUrl.origin));
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|\.well-known|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|json)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
