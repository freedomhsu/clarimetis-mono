"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api } from "@/lib/api";

export type BillingCycle = "monthly" | "annual";
export type BillingAction = BillingCycle | "portal" | null;

export interface BillingState {
  tier: "free" | "pro";
  loading: BillingAction;
  error: string | null;
  loadTier: () => Promise<void>;
  subscribe: (plan: BillingCycle) => Promise<void>;
  openBillingPortal: () => Promise<void>;
  /** Allow external callers (e.g. DashboardProvider) to set tier directly. */
  setTier: React.Dispatch<React.SetStateAction<"free" | "pro">>;
}

export function useBilling(): BillingState {
  const { getToken, isSignedIn } = useAuth();
  const [tier, setTier] = useState<"free" | "pro">("free");
  const [loading, setLoading] = useState<BillingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTier = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const me = await api.getMe(token);
      setTier(me.subscription_tier === "pro" ? "pro" : "free");
    } catch {
      // Silently default to "free" — safer to gate features than to open them.
    }
  }, [getToken]);

  const subscribe = useCallback(
    async (plan: BillingCycle) => {
      setError(null);
      if (!isSignedIn) {
        window.location.href = "/sign-in";
        return;
      }
      setLoading(plan);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");
        const url = await api.getSubscribeUrl(token, plan);
        window.location.href = url;
      } catch {
        setError("Could not start checkout. Please try again.");
        setLoading(null);
      }
    },
    [getToken, isSignedIn],
  );

  const openBillingPortal = useCallback(async () => {
    setError(null);
    setLoading("portal");
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const url = await api.getBillingPortalUrl(token);
      window.location.href = url;
    } catch {
      setError("Could not open billing portal. Please try again.");
      setLoading(null);
    }
  }, [getToken]);

  return { tier, setTier, loading, error, loadTier, subscribe, openBillingPortal };
}
