"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { SubscriptionTier, getTierFromMetadata, PLANS } from "@/lib/subscription";

interface SubscriptionContextType {
  tier: SubscriptionTier;
  isPremium: boolean;
  isLoaded: boolean;
  backtestsUsed: number;
  backtestsRemaining: number;
  canRunBacktest: boolean;
  incrementBacktestUsage: () => void;
  refreshUsage: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType>({
  tier: "free",
  isPremium: false,
  isLoaded: false,
  backtestsUsed: 0,
  backtestsRemaining: PLANS.free.backtestsPerMonth,
  canRunBacktest: true,
  incrementBacktestUsage: () => {},
  refreshUsage: async () => {},
});

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const [backtestsUsed, setBacktestsUsed] = useState(0);

  const tier = getTierFromMetadata(
    user?.publicMetadata as Record<string, unknown> | undefined
  );
  const isPremium = tier === "premium";

  // Fetch usage from server for logged-in free users
  const refreshUsage = useCallback(async () => {
    if (!user?.id || isPremium) return;
    try {
      const res = await fetch("/api/usage");
      const data = await res.json();
      if (typeof data.backtestCount === "number") {
        setBacktestsUsed(data.backtestCount);
      }
    } catch {
      /* ignore */
    }
  }, [user?.id, isPremium]);

  useEffect(() => {
    if (isLoaded && user?.id && !isPremium) {
      refreshUsage();
    }
  }, [isLoaded, user?.id, isPremium, refreshUsage]);

  const backtestsRemaining = isPremium
    ? Infinity
    : Math.max(0, PLANS.free.backtestsPerMonth - backtestsUsed);
  const canRunBacktest = isPremium || backtestsUsed < PLANS.free.backtestsPerMonth;

  const incrementBacktestUsage = useCallback(() => {
    if (!isPremium) {
      setBacktestsUsed((prev) => prev + 1);
    }
  }, [isPremium]);

  return (
    <SubscriptionContext.Provider
      value={{
        tier,
        isPremium,
        isLoaded,
        backtestsUsed,
        backtestsRemaining,
        canRunBacktest,
        incrementBacktestUsage,
        refreshUsage,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
