"use client";

import { useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useState, FormEvent } from "react";
import { Loader2, Save, Lock, User, AlertTriangle } from "lucide-react";

export default function AccountPage() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-gray-500" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Account settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your profile and security preferences.
          </p>
        </div>

        <ProfileSection user={user} />
        <PasswordSection user={user} />
        <DangerSection user={user} />
      </div>
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────

function ProfileSection({ user }: { user: ReturnType<typeof useUser>["user"] & object }) {
  const [firstName, setFirstName] = useState(user!.firstName ?? "");
  const [lastName, setLastName] = useState(user!.lastName ?? "");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await user!.update({ firstName, lastName });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setSaving(false);
    }
  }

  const email = user!.primaryEmailAddress?.emailAddress ?? "";
  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((n) => n[0].toUpperCase())
    .join("") || email[0]?.toUpperCase() || "?";

  return (
    <Section icon={<User size={16} />} title="Profile">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          {user!.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user!.imageUrl}
              alt="Profile photo"
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xl font-bold">
              {initials}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {[firstName, lastName].filter(Boolean).join(" ") || "—"}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="First name"
            value={firstName}
            onChange={setFirstName}
            autoComplete="given-name"
          />
          <Field
            label="Last name"
            value={lastName}
            onChange={setLastName}
            autoComplete="family-name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Email address
          </label>
          <input
            type="email"
            value={email}
            disabled
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
          />
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
            Email changes are managed through your email provider.
          </p>
        </div>

        {error && <ErrorMsg msg={error} />}
        {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Changes saved.</p>}

        <div className="flex justify-end">
          <SaveButton saving={saving} />
        </div>
      </form>
    </Section>
  );
}

// ── Password ──────────────────────────────────────────────────────────────

function PasswordSection({ user }: { user: ReturnType<typeof useUser>["user"] & object }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await user!.updatePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section icon={<Lock size={16} />} title="Change password">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          <Field
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
        </div>

        {error && <ErrorMsg msg={error} />}
        {success && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            Password updated successfully.
          </p>
        )}

        <div className="flex justify-end">
          <SaveButton saving={saving} label="Update password" />
        </div>
      </form>
    </Section>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────

function DangerSection({ user }: { user: ReturnType<typeof useUser>["user"] & object }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await user!.delete();
      // Clerk redirects to "/" after deletion
    } catch (err) {
      setError(clerkError(err));
      setDeleting(false);
    }
  }

  return (
    <Section
      icon={<AlertTriangle size={16} />}
      title="Danger zone"
      danger
    >
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Permanently delete your account and all associated data. This action cannot be undone.
      </p>

      {error && <ErrorMsg msg={error} />}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
        >
          Delete account
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {deleting && <Loader2 size={14} className="animate-spin" />}
            Yes, delete my account
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </Section>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-2xl border p-6 ${
        danger
          ? "border-red-200 dark:border-red-900"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-center gap-2 mb-5">
        <span
          className={`${danger ? "text-red-500" : "text-gray-500 dark:text-gray-400"}`}
        >
          {icon}
        </span>
        <h2
          className={`text-sm font-semibold uppercase tracking-wider ${
            danger ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300"
          }`}
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full px-3.5 py-2.5 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 outline-none transition-all"
      />
    </div>
  );
}

function SaveButton({
  saving,
  label = "Save changes",
}: {
  saving: boolean;
  label?: string;
}) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-violet-600 shadow-md shadow-brand-500/20 hover:opacity-90 transition-opacity disabled:opacity-60"
    >
      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {label}
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3.5 py-2.5 rounded-xl">
      {msg}
    </p>
  );
}

function clerkError(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "An error occurred.";
  }
  return "An unexpected error occurred. Please try again.";
}
