// Subscription tier definitions and helpers

export type SubscriptionTier = "free" | "premium";

export const PLANS = {
  free: {
    name: "Free",
    backtestsPerMonth: 3,
    signalPreviewCount: 1, // most recent active signal only
    analyzerVisibleStocks: 1, // top stock only
    portfolioFullAnalysis: false,
    leaderboardSave: false,
  },
  premium: {
    name: "Premium",
    backtestsPerMonth: Infinity,
    signalPreviewCount: Infinity,
    analyzerVisibleStocks: Infinity,
    portfolioFullAnalysis: true,
    leaderboardSave: true,
    trialDays: 7,
    price: {
      monthly: 2499, // cents
      annual: 1999, // cents/month
      annualTotal: 23988, // cents/year
    },
  },
} as const;

export const STRIPE_PRICE_IDS = {
  monthly: process.env.STRIPE_MONTHLY_PRICE_ID || "",
  annual: process.env.STRIPE_ANNUAL_PRICE_ID || "",
};

/**
 * Determine tier from Clerk user publicMetadata.
 * Returns "free" if no metadata or plan not set to "premium".
 * Premium passes auto-expire based on premiumPassExpiresAt.
 */
export function getTierFromMetadata(
  publicMetadata: Record<string, unknown> | undefined | null
): SubscriptionTier {
  if (!publicMetadata) return "free";
  if (publicMetadata.plan !== "premium") return "free";

  // If this is a premium pass (no Stripe subscription), check expiry
  const passExpiry = publicMetadata.premiumPassExpiresAt as number | undefined;
  if (passExpiry && !publicMetadata.stripeSubscriptionId) {
    if (Date.now() / 1000 > passExpiry) return "free";
  }

  return "premium";
}

/**
 * Check if a user's subscription is active (not expired/cancelled).
 * Uses status from Clerk publicMetadata set by Stripe webhooks.
 * For free users this always returns true.
 */
export function isSubscriptionActive(
  publicMetadata: Record<string, unknown> | undefined | null
): boolean {
  if (!publicMetadata) return true; // free tier is always "active"
  const tier = getTierFromMetadata(publicMetadata);
  if (tier === "free") return true;
  const status = publicMetadata.subscriptionStatus as string | undefined;
  if (!status) return true;
  return ["active", "trialing"].includes(status);
}

/** Format price in dollars from cents */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
