"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useState, useEffect, FormEvent } from "react";
import { Loader2, Save, Lock, User, AlertTriangle, Brain, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/components/providers/I18nContext";
import type { Lang } from "@/lib/i18n";

export default function AccountPage() {
  const { user, isLoaded } = useUser();
  const { t } = useI18n();

  if (!isLoaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-indigo-400" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="h-full min-h-screen overflow-y-auto bg-slate-50 dark:bg-[#080810]">
      <div className="max-w-2xl mx-auto px-6 pt-8 pb-12 space-y-6">

        {/* Header panel */}
        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#0c0c18] border border-indigo-900/40 shadow-xl">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 left-0 w-28 h-full bg-gradient-to-r from-indigo-600/[0.07] to-transparent" />
            <div className="absolute -top-2 left-8 w-16 h-8 rounded-full bg-indigo-500/10 blur-2xl" />
          </div>
          <div className="relative z-10 flex items-center gap-4 px-7 pt-6 pb-5">
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-indigo-500/35 to-violet-600/35 blur-lg" />
              <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/30 ring-1 ring-white/[0.12]">
                <Brain size={16} className="text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent tracking-tight">{t("account_title")}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t("account_subtitle")}</p>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 dark:via-indigo-500/30 to-transparent" />
        </div>

        <ProfileSection user={user} />
        <div id="language">
          <LanguageSection />
        </div>
        <PasswordSection user={user} />
        <DangerSection user={user} />
      </div>
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────

function ProfileSection({ user }: { user: ReturnType<typeof useUser>["user"] & object }) {
  const { t } = useI18n();
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
    <Section icon={<User size={16} />} title={t("account_profile")}>
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
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xl font-bold">
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
            label={t("field_first_name")}
            value={firstName}
            onChange={setFirstName}
            autoComplete="given-name"
          />
          <Field
            label={t("field_last_name")}
            value={lastName}
            onChange={setLastName}
            autoComplete="family-name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            {t("field_email")}
          </label>
          <input
            type="email"
            value={email}
            disabled
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-100 dark:bg-indigo-950/30 border border-slate-200 dark:border-indigo-900/40 text-slate-400 dark:text-slate-500 cursor-not-allowed"
          />
          <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">
            {t("field_email_note")}
          </p>
        </div>

        {error && <ErrorMsg msg={error} />}
        {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("msg_changes_saved")}</p>}

        <div className="flex justify-end">
          <SaveButton saving={saving} label={t("btn_save")} />
        </div>
      </form>
    </Section>
  );
}

// ── Language ──────────────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES = [
  { code: "en",    label: "English",                  flag: "🇺🇸" },
  { code: "es",    label: "Español",                  flag: "🇪🇸" },
  { code: "pt",    label: "Português",                flag: "🇧🇷" },
  { code: "fr",    label: "Français",                 flag: "🇫🇷" },  { code: "it",    label: "Italiano",                 flag: "🇮🇹" },  { code: "zh-TW", label: "繁體中文 (Traditional)",   flag: "�" },
  { code: "ja",    label: "日本語",                   flag: "🇯🇵" },
  { code: "ko",    label: "한국어",                   flag: "🇰🇷" },
] as const;

function LanguageSection() {
  const { lang, setLang, t } = useI18n();
  const [selected, setSelected] = useState<string>(lang);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep selected in sync if language is changed externally (e.g. sidebar picker)
  useEffect(() => { setSelected(lang); }, [lang]);

  function handleSave() {
    if (selected === lang || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      setLang(selected as Lang);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  const isDirty = selected !== lang;

  return (
    <Section icon={<Globe size={16} />} title={t("account_language")}>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        {t("account_language_desc")}
      </p>

      <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => setSelected(lang.code)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                  selected === lang.code
                    ? "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-500 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-400/40"
                    : "bg-slate-50 dark:bg-[#16162a] border-slate-200 dark:border-indigo-900/40 text-slate-700 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700"
                }`}
              >
                <span className="text-xl leading-none">{lang.flag}</span>
                <span>{lang.label}</span>
                {selected === lang.code && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />
                )}
              </button>
            ))}
          </div>

          {error && <ErrorMsg msg={error} />}
          {success && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("account_language_saved")}</p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-md shadow-indigo-900/25 ring-1 ring-white/[0.10] hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t("account_language_save")}
            </button>
          </div>
        </div>
    </Section>
  );
}

// ── Password ──────────────────────────────────────────────────────────────

function PasswordSection({ user }: { user: ReturnType<typeof useUser>["user"] & object }) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(t("msg_password_mismatch"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("msg_password_short"));
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
    <Section icon={<Lock size={16} />} title={t("account_password")}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label={t("field_current_password")}
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t("field_new_password")}
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          <Field
            label={t("field_confirm_password")}
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
        </div>

        {error && <ErrorMsg msg={error} />}
        {success && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {t("msg_password_updated")}
          </p>
        )}

        <div className="flex justify-end">
          <SaveButton saving={saving} label={t("btn_save_password")} />
        </div>
      </form>
    </Section>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────

function DangerSection({ user }: { user: ReturnType<typeof useUser>["user"] & object }) {
  const { t } = useI18n();
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
      title={t("account_danger")}
      danger
    >
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        {t("account_danger_desc")}
      </p>

      {error && <ErrorMsg msg={error} />}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
        >
          {t("btn_delete_account")}
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
            {t("btn_delete_confirm")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-indigo-900/40 hover:bg-slate-50 dark:hover:bg-[#16162a] transition-colors"
          >
            {t("btn_cancel")}
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
      className={`bg-white dark:bg-[#13131f] rounded-2xl border p-6 ${
        danger
          ? "border-red-200 dark:border-red-900/60"
          : "border-slate-200 dark:border-indigo-900/40"
      }`}
    >
      <div className="flex items-center gap-2.5 mb-5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
          danger
            ? "bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900/60 text-red-500"
            : "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-100 dark:border-indigo-800/50 text-indigo-500 dark:text-indigo-400"
        }`}>
          {icon}
        </div>
        <h2
          className={`text-[10px] font-semibold uppercase tracking-widest ${
            danger ? "text-red-500 dark:text-red-400" : "text-slate-400 dark:text-slate-500"
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
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 bg-slate-50 dark:bg-[#16162a] border border-slate-200 dark:border-indigo-900/40 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
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
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-md shadow-indigo-900/25 ring-1 ring-white/[0.10] hover:opacity-90 transition-opacity disabled:opacity-60"
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
