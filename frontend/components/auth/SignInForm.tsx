"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, FormEvent, useEffect } from "react";
import Link from "next/link";
import { AuthCard } from "./AuthCard";
import { AuthInput } from "./AuthInput";
import { GoogleIcon } from "./GoogleIcon";
import { AppleIcon } from "./AppleIcon";
import { Loader2 } from "lucide-react";

type Step = "identifier" | "password";

/** Safely extract a same-site redirect path from the ?redirect_url param. */
function getSafeRedirect(searchParams: ReturnType<typeof useSearchParams>, fallback = "/dashboard"): string {
  const raw = searchParams.get("redirect_url");
  if (!raw) return fallback;
  try {
    // Allow absolute URLs on the same origin
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    // Fall through — treat as relative if it starts with /
  }
  return raw.startsWith("/") ? raw : fallback;
}

export function SignInForm() {
  const { isSignedIn } = useAuth();
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Already authenticated — skip the form and go straight to the redirect target.
  // This handles the case where Stripe (or any external redirect) sends the user
  // back through /sign-in?redirect_url=... even though they're still logged in.
  useEffect(() => {
    if (isSignedIn) {
      router.replace(getSafeRedirect(searchParams));
    }
  }, [isSignedIn, router, searchParams]);

  const [step, setStep] = useState<Step>("identifier");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Step 1: submit email ──────────────────────────────────────────────
  async function handleIdentifier(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      await signIn.create({ identifier: email });
      setStep("password");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: submit password ───────────────────────────────────────────
  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "password",
        password,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.push(getSafeRedirect(searchParams));
      } else {
        setError("Additional verification required. Please try again.");
      }
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Google OAuth ──────────────────────────────────────────────────────
  async function handleGoogle() {
    if (!isLoaded) return;
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
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
      await signIn.authenticateWithRedirect({
        strategy: "oauth_apple",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: getSafeRedirect(searchParams),
      });
    } catch (err) {
      setError(clerkError(err));
    }
  }

  // Show a neutral loading state while Clerk SDK is initialising or while
  // the redirect for an already-authenticated user is in flight.  Avoids
  // painting the sign-in form at all for users who are already signed in.
  if (!isLoaded || isSignedIn) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={28} className="animate-spin text-brand-500" />
      </div>
    );
  }

  return (
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

      {step === "identifier" ? (
        <form onSubmit={handleIdentifier} className="space-y-4">
          <AuthInput
            label="Email address"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error ?? undefined}
            required
            autoFocus
          />
          <SubmitButton loading={loading} label="Continue" />
        </form>
      ) : (
        <form onSubmit={handlePassword} className="space-y-4">
          {/* Read-only email chip */}
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-gray-800 border border-gray-700">
            <span className="text-sm text-white truncate">{email}</span>
            <button
              type="button"
              onClick={() => { setStep("identifier"); setPassword(""); setError(null); }}
              className="ml-2 text-xs text-brand-400 hover:text-brand-300 shrink-0"
            >
              Change
            </button>
          </div>
          <AuthInput
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
            required
            autoFocus
          />
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <SubmitButton loading={loading} label="Sign in" />
        </form>
      )}

      <p className="text-center text-sm text-gray-500 mt-5">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="text-brand-400 hover:text-brand-300 font-medium">
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-white text-sm font-semibold shadow-lg shadow-brand-500/25 hover:opacity-90 transition-opacity disabled:opacity-60"
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {label}
    </button>
  );
}

function clerkError(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "An error occurred.";
  }
  return "An unexpected error occurred. Please try again.";
}
