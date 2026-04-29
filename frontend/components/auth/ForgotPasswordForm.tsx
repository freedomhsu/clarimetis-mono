"use client";

import { useSignIn } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "./AuthCard";
import { AuthInput } from "./AuthInput";
import { Loader2, MailCheck } from "lucide-react";

type Step = "email" | "reset";

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

export function ForgotPasswordForm() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1 — send reset code
  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email,
      });
      setStep("reset");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  }

  // Step 2 — verify code + set new password
  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
        password: newPassword,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.push(getSafeRedirect(searchParams));
      } else {
        setError("Could not reset password. Please try again.");
      }
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  }

  if (step === "email") {
    return (
      <AuthCard
        title="Reset your password"
        subtitle="Enter your email and we'll send you a reset code"
      >
        <form onSubmit={handleEmailSubmit} className="space-y-4">
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
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-white text-sm font-semibold shadow-lg shadow-brand-500/25 hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            Send reset code
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-5">
          <Link href="/sign-in" className="text-brand-400 hover:text-brand-300 font-medium">
            &larr; Back to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set new password"
      subtitle={`Enter the code sent to ${email} and choose a new password`}
    >
      <div className="flex justify-center mb-5">
        <div className="w-11 h-11 rounded-full bg-brand-500/15 flex items-center justify-center">
          <MailCheck size={20} className="text-brand-400" />
        </div>
      </div>

      <form onSubmit={handleResetSubmit} className="space-y-4">
        <AuthInput
          label="Verification code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
          autoFocus
        />
        <AuthInput
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <AuthInput
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={error ?? undefined}
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-white text-sm font-semibold shadow-lg shadow-brand-500/25 hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading && <Loader2 size={15} className="animate-spin" />}
          Reset password
        </button>
      </form>

      <div className="text-center mt-4">
        <button
          type="button"
          onClick={() => { setStep("email"); setError(null); }}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          &larr; Change email
        </button>
      </div>
    </AuthCard>
  );
}

function clerkError(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "An error occurred.";
  }
  return "An unexpected error occurred. Please try again.";
}
