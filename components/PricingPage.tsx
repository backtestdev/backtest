"use client";

import { useState } from "react";
import { useUser, SignUpButton } from "@clerk/nextjs";
import { useSubscription } from "@/components/SubscriptionProvider";
import { PLANS } from "@/lib/subscription";
import { useSearchParams } from "next/navigation";

const FREE_FEATURES = [
  "3 AI backtests per month",
  "1 signal preview (most recent pick)",
  "Top-ranked stock visible in Analyzer",
  "Portfolio analysis summary",
  "Full access to sold signal history",
];

const PREMIUM_FEATURES = [
  "Unlimited AI backtests",
  "All active signals with live scoring",
  "Email alerts for new picks & exits",
  "Full AI Stock Analyzer access",
  "Complete portfolio analysis with AI advice",
  "Save strategies to leaderboard",
  "Priority support",
];

export default function PricingPage() {
  const { isSignedIn } = useUser();
  const { isPremium } = useSubscription();
  const searchParams = useSearchParams();
  const success = searchParams.get("success") === "true";
  const canceled = searchParams.get("canceled") === "true";
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");
  const [loading, setLoading] = useState(false);

  const monthlyPrice = billing === "annual"
    ? PLANS.premium.price.annual
    : PLANS.premium.price.monthly;
  const monthlyDisplay = `$${(monthlyPrice / 100).toFixed(2)}`;
  const annualSavings = Math.round(
    ((PLANS.premium.price.monthly - PLANS.premium.price.annual) / PLANS.premium.price.monthly) * 100
  );

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billing }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to start checkout");
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleManage = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      alert("Failed to open billing portal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-10 sm:py-16">
      <div className="max-w-4xl mx-auto">
        {/* Success/Cancel banners */}
        {success && (
          <div className="mb-8 p-4 rounded-xl bg-th-positive-bg border border-th-positive-border text-center">
            <p className="text-sm font-semibold text-th-positive">Welcome to Premium! Your 7-day free trial has started.</p>
            <p className="text-xs text-th-positive mt-1">You now have full access to all features.</p>
          </div>
        )}
        {canceled && (
          <div className="mb-8 p-4 rounded-xl bg-th-warning-bg border border-th-warning-border text-center">
            <p className="text-sm font-medium text-th-warning">Checkout was canceled. No charges were made.</p>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-th-text tracking-tight">
            Simple, transparent pricing
          </h1>
          <p className="mt-3 text-base text-th-text-3 max-w-lg mx-auto">
            Start free with powerful tools. Upgrade for unlimited access and premium signals.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <button
            onClick={() => setBilling("monthly")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              billing === "monthly"
                ? "bg-th-surface border border-th-border text-th-text shadow-sm"
                : "text-th-text-3 hover:text-th-text-2"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling("annual")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              billing === "annual"
                ? "bg-th-surface border border-th-border text-th-text shadow-sm"
                : "text-th-text-3 hover:text-th-text-2"
            }`}
          >
            Annual
            <span className="ml-1.5 text-[10px] font-bold text-th-positive bg-th-positive-bg px-1.5 py-0.5 rounded-full">
              Save {annualSavings}%
            </span>
          </button>
        </div>

        {/* Plans */}
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Free Plan */}
          <div className="bg-th-surface rounded-2xl border border-th-border-light p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-th-text">Free</h2>
              <p className="text-sm text-th-text-3 mt-1">Get started with core features</p>
            </div>
            <div className="mb-6">
              <span className="text-4xl font-bold text-th-text">$0</span>
              <span className="text-sm text-th-text-3 ml-1">/month</span>
            </div>
            {isSignedIn && !isPremium ? (
              <div className="w-full py-2.5 text-sm font-medium text-th-text-3 bg-th-inset border border-th-border rounded-xl text-center">
                Current Plan
              </div>
            ) : !isSignedIn ? (
              <SignUpButton mode="modal" forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}>
                <button className="w-full py-2.5 text-sm font-medium text-th-text bg-th-surface border border-th-border rounded-xl hover:bg-th-hover transition-colors">
                  Create Free Account
                </button>
              </SignUpButton>
            ) : null}
            <ul className="mt-6 space-y-3">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-th-text-2">
                  <svg className="w-4 h-4 text-th-text-3 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Premium Plan */}
          <div className="bg-th-surface rounded-2xl border-2 border-th-accent p-6 sm:p-8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="px-3 py-1 text-xs font-bold text-white bg-th-accent rounded-full shadow-sm">
                Most Popular
              </span>
            </div>
            <div className="mb-6">
              <h2 className="text-lg font-bold text-th-text">Premium</h2>
              <p className="text-sm text-th-text-3 mt-1">Full access to everything</p>
            </div>
            <div className="mb-1">
              <span className="text-4xl font-bold text-th-text">{monthlyDisplay}</span>
              <span className="text-sm text-th-text-3 ml-1">/month</span>
            </div>
            {billing === "annual" && (
              <p className="text-xs text-th-text-3 mb-6">
                ${(PLANS.premium.price.annualTotal / 100).toFixed(2)}/year, billed annually
              </p>
            )}
            {billing === "monthly" && (
              <p className="text-xs text-th-text-3 mb-6">
                Billed monthly
              </p>
            )}
            {isPremium ? (
              <button
                onClick={handleManage}
                disabled={loading}
                className="w-full py-2.5 text-sm font-medium text-th-accent bg-th-accent-bg border border-th-accent-border rounded-xl hover:bg-th-accent-muted transition-colors disabled:opacity-50"
              >
                {loading ? "Loading..." : "Manage Subscription"}
              </button>
            ) : isSignedIn ? (
              <button
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full py-2.5 text-sm font-semibold text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors disabled:opacity-50 shadow-sm"
              >
                {loading ? "Loading..." : "Start 7-Day Free Trial"}
              </button>
            ) : (
              <SignUpButton mode="modal" forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}>
                <button className="w-full py-2.5 text-sm font-semibold text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors shadow-sm">
                  Sign Up Free, Then Upgrade
                </button>
              </SignUpButton>
            )}
            {!isPremium && (
              <p className="text-[10px] text-th-text-4 text-center mt-2">
                7-day free trial. Cancel anytime. No charge until trial ends.
              </p>
            )}
            <ul className="mt-6 space-y-3">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-th-text-2">
                  <svg className="w-4 h-4 text-th-accent mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-16 max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-th-text text-center mb-6">Frequently asked questions</h2>
          <div className="space-y-4">
            <FaqItem
              q="What happens during the free trial?"
              a="You get full Premium access for 7 days. If you don't cancel before the trial ends, you'll be charged the subscription price. You can cancel anytime from the billing portal."
            />
            <FaqItem
              q="Can I cancel anytime?"
              a="Yes. Cancel from your billing portal at any time. You'll keep Premium access until the end of your current billing period."
            />
            <FaqItem
              q="What payment methods do you accept?"
              a="We accept all major credit and debit cards through Stripe, our secure payment processor."
            />
            <FaqItem
              q="What's included in the free plan?"
              a="3 backtests per month, 1 signal preview, the top-ranked stock in the Analyzer, a portfolio analysis summary, and full access to closed signal history."
            />
          </div>
        </div>

        {/* Redeem code - subtle, below FAQ */}
        {isSignedIn && !isPremium && <RedeemCode />}

        <p className="text-center mt-12 text-[10px] text-th-text-4">
          For educational purposes only. Not financial advice.
        </p>
      </div>
    </div>
  );
}

function RedeemCode() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleRedeem = async () => {
    if (!code.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: data.message });
        setCode("");
        // Reload after a moment so Clerk metadata refreshes
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResult({ ok: false, message: data.error || "Something went wrong." });
      }
    } catch {
      setResult({ ok: false, message: "Something went wrong." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-10 text-center">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-th-text-4 hover:text-th-text-3 transition-colors"
        >
          Have an access code?
        </button>
      ) : (
        <div className="max-w-xs mx-auto space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
              placeholder="Enter code"
              className="flex-1 px-3 py-2 text-sm text-th-text bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border placeholder:text-th-text-4"
            />
            <button
              onClick={handleRedeem}
              disabled={submitting || !code.trim()}
              className="px-4 py-2 text-sm font-medium text-th-accent bg-th-accent-bg border border-th-accent-border rounded-lg hover:bg-th-accent-muted transition-colors disabled:opacity-40"
            >
              {submitting ? "..." : "Redeem"}
            </button>
          </div>
          {result && (
            <p className={`text-xs ${result.ok ? "text-th-positive" : "text-th-negative"}`}>
              {result.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group bg-th-surface rounded-xl border border-th-border-light">
      <summary className="flex items-center justify-between px-5 py-4 cursor-pointer text-sm font-medium text-th-text select-none list-none [&::-webkit-details-marker]:hidden">
        {q}
        <svg className="w-4 h-4 text-th-text-3 transition-transform group-open:rotate-90 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </summary>
      <div className="px-5 pb-4 text-sm text-th-text-3 leading-relaxed">
        {a}
      </div>
    </details>
  );
}
