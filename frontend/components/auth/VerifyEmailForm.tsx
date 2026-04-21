"use client";

import { useSignUp } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useState, FormEvent, useRef, KeyboardEvent } from "react";
import { AuthCard } from "./AuthCard";
import { Loader2, MailCheck } from "lucide-react";

interface VerifyEmailFormProps {
  email: string;
  onVerified: () => void;
  onBack?: () => void;
}

export function VerifyEmailForm({ email, onVerified, onBack }: VerifyEmailFormProps) {
  const { signUp, isLoaded } = useSignUp();

  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function handleDigit(index: number, value: string) {
    // Allow paste of full code
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      const newCode = [...code];
      digits.forEach((d, i) => {
        if (index + i < 6) newCode[index + i] = d;
      });
      setCode(newCode);
      const nextIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextIndex]?.focus();
      return;
    }
    if (!/^\d?$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    const fullCode = code.join("");
    if (fullCode.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code: fullCode });
      if (result.status === "complete") {
        onVerified();
      } else {
        setError("Verification incomplete. Please try again.");
      }
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!isLoaded || resending) return;
    setResending(true);
    setError(null);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthCard
      title="Check your email"
      subtitle={`We sent a 6-digit code to ${email}`}
    >
      <div className="flex justify-center mb-6">
        <div className="w-12 h-12 rounded-full bg-brand-500/15 flex items-center justify-center">
          <MailCheck size={22} className="text-brand-400" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* OTP digit inputs */}
        <div className="flex gap-2 justify-center">
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={digit}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              autoFocus={i === 0}
              className="w-11 h-12 rounded-xl text-center text-lg font-bold text-white bg-gray-800 border border-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 outline-none transition-all"
              aria-label={`Digit ${i + 1}`}
            />
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-400 text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-white text-sm font-semibold shadow-lg shadow-brand-500/25 hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading && <Loader2 size={15} className="animate-spin" />}
          Verify email
        </button>
      </form>

      <div className="mt-5 flex flex-col items-center gap-2">
        {resent ? (
          <p className="text-xs text-emerald-400">Code resent — check your inbox.</p>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            {resending ? "Resending…" : "Didn't receive it? Resend code"}
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            &larr; Change email address
          </button>
        )}
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
