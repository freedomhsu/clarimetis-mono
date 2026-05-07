"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Brain,
  Download,
  Film,
  FolderOpen,
  Loader2,
  Lock,
  Trash2,
} from "lucide-react";
import { type MediaFile } from "@/lib/api";
import { useMediaLibrary, QUOTA_BYTES } from "@/lib/hooks/useMediaLibrary";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}

// ── Shared layout ─────────────────────────────────────────────────────────────

/**
 * The gradient header block shared between the main page and the upgrade gate.
 * Extracted to eliminate the duplicated JSX that previously appeared in both.
 */
function PageHeader() {
  return (
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
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent tracking-tight">
            Media Library
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Your uploaded photos and videos.
          </p>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 dark:via-indigo-500/30 to-transparent" />
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full min-h-screen overflow-y-auto bg-slate-50 dark:bg-[#080810]">
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-12 space-y-6">
        <PageHeader />
        {children}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MediaLibraryPage() {
  const {
    status,
    files,
    storageUsedBytes,
    error,
    deleting,
    confirmDelete,
    handleDelete,
    cancelDelete,
  } = useMediaLibrary();

  const quotaPct = Math.min(100, (storageUsedBytes / QUOTA_BYTES) * 100);
  // Derived from the constant so it stays in sync if the quota is ever changed.
  const quotaLabel = formatBytes(QUOTA_BYTES);

  if (status === "gated") {
    return <UpgradeGate />;
  }

  return (
    <PageShell>
      {/* ── Loading ── */}
      {status === "loading" && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-indigo-400" />
        </div>
      )}

      {/* ── Error ── */}
      {(status === "error" || error) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {status === "ready" && (
        <>
          {/* ── Storage quota bar ── */}
          <div className="bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 rounded-2xl px-6 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Storage used</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {formatBytes(storageUsedBytes)}{" "}
                <span className="text-slate-400 dark:text-slate-600">/ {quotaLabel}</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-[#16162a] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-500"
                style={{ width: `${quotaPct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-1.5">
              {files.length} {files.length === 1 ? "file" : "files"}
            </p>
          </div>

          {/* ── Empty state ── */}
          {files.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/50 flex items-center justify-center mb-4">
                <FolderOpen size={22} className="text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No files uploaded yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">
                Upload photos or videos in a coaching chat to see them here.
              </p>
            </div>
          )}

          {/* ── File grid ── */}
          {files.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {files.map((file) => (
                <FileCard
                  key={file.blob_path}
                  file={file}
                  isDeleting={deleting === file.blob_path}
                  isPendingConfirm={confirmDelete === file.blob_path}
                  onDelete={() => handleDelete(file.blob_path)}
                  onCancelDelete={cancelDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

// ── File card ─────────────────────────────────────────────────────────────────

interface FileCardProps {
  file: MediaFile;
  isDeleting: boolean;
  isPendingConfirm: boolean;
  onDelete: () => void;
  onCancelDelete: () => void;
}

function FileCard({ file, isDeleting, isPendingConfirm, onDelete, onCancelDelete }: FileCardProps) {
  return (
    <div className="bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 rounded-2xl overflow-hidden flex flex-col">
      {/* Preview */}
      <div className="relative h-40 bg-slate-100 dark:bg-[#16162a] flex items-center justify-center overflow-hidden">
        {isImage(file.content_type) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.url}
            alt={file.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Film size={32} className="text-indigo-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-widest">Video</span>
          </div>
        )}
      </div>

      {/* Info + actions */}
      <div className="px-4 py-3 flex flex-col gap-2.5">
        <div>
          <p
            className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate"
            title={file.filename}
          >
            {file.filename}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-0.5">
            {formatBytes(file.size_bytes)} · {formatDate(file.uploaded_at)}
          </p>
        </div>

        {isPendingConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-500 dark:text-red-400 font-medium flex-1">
              Delete this file?
            </span>
            <button
              onClick={onDelete}
              className="px-2.5 py-1 text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              Yes
            </button>
            <button
              onClick={onCancelDelete}
              className="px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-[#16162a] rounded-lg transition-colors hover:bg-slate-200 dark:hover:bg-indigo-900/30"
            >
              No
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              download={file.filename}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/50 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors flex-1"
            >
              <Download size={12} />
              Download
            </a>
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="p-1.5 text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors disabled:opacity-50"
              title="Delete file"
            >
              {isDeleting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Upgrade gate ──────────────────────────────────────────────────────────────

function UpgradeGate() {
  return (
    <PageShell>
      <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#13131f] border border-indigo-800/50 p-8 text-center">
        <div className="pointer-events-none absolute top-0 right-0 w-40 h-full bg-gradient-to-l from-violet-500/10 to-transparent" />
        <div className="pointer-events-none absolute -top-6 right-10 w-24 h-16 rounded-full bg-violet-500/10 blur-2xl" />

        <div className="relative mx-auto w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 flex items-center justify-center mb-5">
          <Lock size={22} className="text-indigo-400" />
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
          Media Library is a Pro feature
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
          Upgrade to Pro to upload and manage photos and videos in your coaching sessions.
        </p>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-sm font-bold transition-all shadow-lg shadow-indigo-900/20 ring-1 ring-white/[0.10]"
        >
          Upgrade to Pro
          <ArrowUpRight size={15} />
        </Link>
      </div>
    </PageShell>
  );
}
