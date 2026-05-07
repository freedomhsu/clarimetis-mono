"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, type MediaFile, type SubscriptionError } from "@/lib/api";

/**
 * 500 MB — mirrors the backend default (Settings.max_pro_storage_bytes).
 * Centralised here so both the quota bar label and the percentage calculation
 * always stay in sync with a single constant.
 */
export const QUOTA_BYTES = 500 * 1024 * 1024;

export type MediaLibraryStatus = "loading" | "ready" | "gated" | "error";

export interface UseMediaLibraryReturn {
  status: MediaLibraryStatus;
  files: MediaFile[];
  /** Sum of all loaded file sizes — used for the quota bar. */
  storageUsedBytes: number;
  error: string | null;
  /** blob_path of the file currently being deleted, or null. */
  deleting: string | null;
  /** blob_path waiting for the user's delete confirmation, or null. */
  confirmDelete: string | null;
  /** Re-trigger a full list refresh (e.g. after an external upload). */
  reload: () => void;
  /**
   * Two-stage delete:
   *   1st call  → sets `confirmDelete` (shows the inline confirm prompt).
   *   2nd call  → executes the DELETE request and removes the file from state.
   */
  handleDelete: (blobPath: string) => Promise<void>;
  /** Dismiss the pending confirmation without deleting. */
  cancelDelete: () => void;
}

export function useMediaLibrary(): UseMediaLibraryReturn {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<MediaLibraryStatus>("loading");
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Derived — recomputed on every render but O(n) over a small list.
  const storageUsedBytes = files.reduce((sum, f) => sum + f.size_bytes, 0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const token = await getToken();
      if (!token || signal?.aborted) return;
      setStatus("loading");
      setError(null);
      try {
        const data = await api.listMedia(token);
        // Guard against state updates after the component unmounts or before
        // a subsequent load() call replaces this one.
        if (signal?.aborted) return;
        setFiles(data);
        setStatus("ready");
      } catch (e) {
        if (signal?.aborted) return;
        const subErr = (e as { subscriptionError?: SubscriptionError })
          .subscriptionError;
        if (subErr) {
          setStatus("gated");
        } else {
          setError(e instanceof Error ? e.message : "Failed to load files.");
          setStatus("error");
        }
      }
    },
    [getToken],
  );

  // Initial load — abort in-flight request on unmount to prevent stale updates.
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const handleDelete = useCallback(
    async (blobPath: string) => {
      // First click: show the inline confirmation prompt.
      if (confirmDelete !== blobPath) {
        setConfirmDelete(blobPath);
        return;
      }

      // Second click: execute the deletion.
      setConfirmDelete(null);
      setDeleting(blobPath);
      try {
        const token = await getToken();
        if (!token) return;
        await api.deleteMedia(token, blobPath);
        // Optimistic update — remove the card immediately without a re-fetch.
        setFiles((prev) => prev.filter((f) => f.blob_path !== blobPath));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed.");
      } finally {
        setDeleting(null);
      }
    },
    [confirmDelete, getToken],
  );

  const cancelDelete = useCallback(() => setConfirmDelete(null), []);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return {
    status,
    files,
    storageUsedBytes,
    error,
    deleting,
    confirmDelete,
    reload,
    handleDelete,
    cancelDelete,
  };
}
