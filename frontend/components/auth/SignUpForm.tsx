"use client";

import { useAuth, useSignUp } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, FormEvent, useEffect } from "react";
import Link from "next/link";
import { AuthCard } from "./AuthCard";
import { AuthInput } from "./AuthInput";
import { GoogleIcon } from "./GoogleIcon";
import { AppleIcon } from "./AppleIcon";
import { VerifyEmailForm } from "./VerifyEmailForm";
import { Loader2 } from "lucide-react";

function getSafeRedirect(searchParams: ReturnType<typeof useSearchParams>, fallback = "/dashboard"): string {
  const raw = searchParams.get("redirect_url");
  if (!raw) return fallback;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    // Fall through
  }
  return raw.startsWith("/") ? raw : fallback;
}

export function SignUpForm() {
  const { isSignedIn } = useAuth();
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (isSignedIn) {
      router.replace(getSafeRedirect(searchParams));
    }
  }, [isSignedIn, router, searchParams]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Submit registration ───────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      await signUp.create({ firstName, lastName, emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setVerifying(true);
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── OTP verified callback ─────────────────────────────────────────────
  async function handleVerified() {
    if (!isLoaded) return;
    if (signUp.status === "complete") {
      await setActive({ session: signUp.createdSessionId });
      router.push(getSafeRedirect(searchParams));
    }
  }

  // ── Google OAuth ──────────────────────────────────────────────────────
  async function handleGoogle() {
    if (!isLoaded) return;
    setError(null);
    try {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: getSafeRedirect(searchParams),
      });
    } catch (err) {
      setError(clerkError(err));
    }
  }

  // ── Apple OAuth ───────────────────────────────────────────────────────
  async function handleApple() {
    if (!isLoaded) return;
    setError(null);
    try {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_apple",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: getSafeRedirect(searchParams),
      });
    } catch (err) {
      setError(clerkError(err));
    }
  }

  // Show a neutral loading state while Clerk SDK is initialising or while
  // the redirect for an already-authenticated user is in flight.
  if (!isLoaded || isSignedIn) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={28} className="animate-spin text-brand-500" />
      </div>
    );
  }

  if (verifying) {
    return (
      <VerifyEmailForm
        email={email}
        onVerified={handleVerified}
        onBack={() => setVerifying(false)}
      />
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start your wellness journey with ClariMetis"
    >
      {/* Social */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-sm font-medium text-white hover:bg-gray-750 hover:border-gray-600 transition-all disabled:opacity-50"
        >
          <GoogleIcon />
          Google
        </button>
        <button
          type="button"
          onClick={handleApple}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-sm font-medium text-white hover:bg-gray-750 hover:border-gray-600 transition-all disabled:opacity-50"
        >
          <AppleIcon />
          Apple
        </button>
      </div>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-gray-800" />
        <span className="text-xs text-gray-500">or</span>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <AuthInput
            label="First name"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            autoFocus
          />
          <AuthInput
            label="Last name"
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
        <AuthInput
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <AuthInput
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-white text-sm font-semibold shadow-lg shadow-brand-500/25 hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading && <Loader2 size={15} className="animate-spin" />}
          Create account
        </button>

        <p className="text-[11px] text-gray-500 text-center leading-relaxed">
          By creating an account you agree to our{" "}
          <a href="/terms" className="text-gray-400 hover:text-white underline">Terms</a>{" "}
          and{" "}
          <a href="/privacy" className="text-gray-400 hover:text-white underline">Privacy Policy</a>.
        </p>
      </form>

      <p className="text-center text-sm text-gray-500 mt-5">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-brand-400 hover:text-brand-300 font-medium">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}

function clerkError(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "An error occurred.";
  }
  return "An unexpected error occurred. Please try again.";
}
