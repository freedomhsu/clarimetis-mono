"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { api } from "@/lib/api";
import { useBilling, type BillingAction, type BillingCycle } from "@/lib/hooks/useBilling";

interface DashboardContextValue {
  /** Current subscription tier — always available, defaults to "free". */
  tier: "free" | "pro";
  /** Which billing action is in-flight, if any. */
  billingLoading: BillingAction;
  /** Last billing error message, or null. */
  billingError: string | null;
  /** Re-fetch the subscription tier from the backend. */
  loadTier: () => Promise<void>;
  /** Redirect to Stripe Checkout for the given plan. */
  subscribe: (plan: BillingCycle) => Promise<void>;
  /** Redirect to the Stripe Billing Portal. */
  openBillingPortal: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue>({
  tier: "free",
  billingLoading: null,
  billingError: null,
  loadTier: async () => {},
  subscribe: async () => {},
  openBillingPortal: async () => {},
});

/** Consume dashboard-wide shared state (tier, billing). */
export function useDashboard() {
  return useContext(DashboardContext);
}

/**
 * Mount once inside the (dashboard) layout.
 *
 * Responsibilities:
 * - Upserts the Clerk user into the backend DB exactly once.
 * - Fetches and exposes the subscription tier so every child can read it
 *   without issuing its own /users/me request.
 * - Provides centralised subscribe / billing-portal actions.
 */
export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const {
    tier,
    loading: billingLoading,
    error: billingError,
    loadTier,
    subscribe,
    openBillingPortal,
  } = useBilling();

  const synced = useRef(false);

  // Sync the Clerk user into the backend DB exactly once per mount.
  useEffect(() => {
    if (!user || synced.current) return;
    synced.current = true;
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) return;
    getToken().then((token) => {
      if (!token) return;
      api.syncUser(token, email, user.fullName ?? undefined).catch(() => {
        // Allow a retry on the next render cycle.
        synced.current = false;
      });
    });
  }, [user, getToken]);

  // Fetch the subscription tier once on mount.
  useEffect(() => {
    loadTier();
  }, [loadTier]);

  return (
    <DashboardContext.Provider
      value={{ tier, billingLoading, billingError, loadTier, subscribe, openBillingPortal }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
