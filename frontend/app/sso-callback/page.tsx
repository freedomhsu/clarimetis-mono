"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/**
 * Clerk needs a page at /sso-callback to finalise the OAuth flow.
 * It handles the token exchange and then redirects to `redirectUrlComplete`.
 */
export default function SSOCallbackPage() {
  return (
    <AuthenticateWithRedirectCallback
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    />
  );
}
