"use client";

import { useState, useEffect } from "react";
import { useUser, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import StockLogo from "./StockLogo";

interface Fundamentals {
  price: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  beta: number | null;
  ipoDate: string | null;
  exchange: string | null;
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  eps: number | null;
  ebitda: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  evToSales: number | null;
  evToEbitda: number | null;
  roe: number | null;
  roic: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  dividendYield: number | null;
  fcfPerShare: number | null;
  enterpriseValue: number | null;
}

interface PriceTarget {
  targetPrice: number;
  probability: number;
  rationale: string;
}

interface AIReport {
  executiveSummary: string;
  bullCase: PriceTarget;
  baseCase: PriceTarget;
  bearCase: PriceTarget;
  riskFactors: string[];
  recommendation: "BUY" | "HOLD" | "SELL";
  recommendationRationale: string;
}

interface RevenueTrendPoint {
  date: string;
  revenue: number;
  netMargin: number;
  eps: number;
}

interface ResearchData {
  ticker: string;
  companyName: string;
  description?: string;
  image?: string;
  isAuthenticated: boolean;
  source: string;
  fundamentals: Fundamentals;
  revenueTrend?: RevenueTrendPoint[];
  report: AIReport | null;
  error?: string;
}

function formatCurrency(val: number | null, decimals = 2): string {
  if (val === null || val === undefined) return "N/A";
  if (Math.abs(val) >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toFixed(decimals)}`;
}

function formatPercent(val: number | null): string {
  if (val === null || val === undefined) return "N/A";
  // If value is already in decimal form (< 1), multiply by 100
  const pct = Math.abs(val) < 1 ? val * 100 : val;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function formatRatio(val: number | null): string {
  if (val === null || val === undefined) return "N/A";
  return val.toFixed(1);
}

const RECOMMENDATION_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  BUY: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  HOLD: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  SELL: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
};

export default function ResearchReport({ ticker }: { ticker: string }) {
  const { isSignedIn } = useUser();
  const [data, setData] = useState<ResearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchResearch() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/research?ticker=${encodeURIComponent(ticker)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to fetch research data (${res.status})`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load research data");
      } finally {
        setLoading(false);
      }
    }
    fetchResearch();
  }, [ticker]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gray-200 rounded-lg animate-pulse" />
            <div>
              <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-32 bg-gray-100 rounded animate-pulse mt-1" />
            </div>
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 bg-white rounded-2xl animate-pulse border border-gray-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50/50 px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/signals" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Signal Explorer
          </Link>
          <div className="bg-white rounded-2xl border border-red-100 p-8 text-center">
            <p className="text-red-500 font-medium">{error || "No data available"}</p>
            <p className="text-sm text-gray-400 mt-2">Check that the ticker is valid and data sources are configured.</p>
          </div>
        </div>
      </div>
    );
  }

  const f = data.fundamentals;
  const report = data.report;
  const recStyle = report ? RECOMMENDATION_STYLES[report.recommendation] || RECOMMENDATION_STYLES.HOLD : null;

  // Probability-weighted target price
  const weightedTarget = report
    ? (report.bullCase.targetPrice * report.bullCase.probability +
       report.baseCase.targetPrice * report.baseCase.probability +
       report.bearCase.targetPrice * report.bearCase.probability) / 100
    : null;

  const impliedUpside = weightedTarget && f.price
    ? ((weightedTarget - f.price) / f.price) * 100
    : null;

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Back link */}
        <Link href="/signals" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Signal Explorer
        </Link>

        {/* Header */}
        <div className="flex items-start gap-4 mb-8">
          <StockLogo ticker={data.ticker} sector={f.sector || undefined} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{data.ticker}</h1>
              {report && recStyle && (
                <span className={`px-3 py-1 text-sm font-bold rounded-lg border ${recStyle.bg} ${recStyle.text} ${recStyle.border}`}>
                  {report.recommendation}
                </span>
              )}
            </div>
            <p className="text-gray-500 mt-0.5">{data.companyName}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
              {f.sector && <span>{f.sector}</span>}
              {f.industry && <><span className="text-gray-200">|</span><span>{f.industry}</span></>}
              {f.exchange && <><span className="text-gray-200">|</span><span>{f.exchange}</span></>}
            </div>
          </div>
          {f.price && (
            <div className="text-right flex-shrink-0">
              <p className="text-2xl font-bold text-gray-900">${f.price.toFixed(2)}</p>
              {weightedTarget && (
                <p className={`text-sm font-medium ${impliedUpside && impliedUpside >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  Target: ${weightedTarget.toFixed(2)} ({impliedUpside ? (impliedUpside >= 0 ? "+" : "") + impliedUpside.toFixed(1) + "%" : ""})
                </p>
              )}
            </div>
          )}
        </div>

        {/* Executive Summary (AI report) */}
        {report && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Executive Summary</h2>
            <p className="text-sm text-gray-600 leading-relaxed">{report.executiveSummary}</p>
            {report.recommendationRationale && (
              <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
                <span className="font-medium text-gray-500">Thesis:</span> {report.recommendationRationale}
              </p>
            )}
          </div>
        )}

        {/* Key Fundamentals Grid */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Key Fundamentals</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard label="Market Cap" value={formatCurrency(f.marketCap)} />
            <MetricCard label="P/E Ratio" value={formatRatio(f.peRatio)} />
            <MetricCard label="EV/Sales" value={formatRatio(f.evToSales)} />
            <MetricCard label="EV/EBITDA" value={formatRatio(f.evToEbitda)} />
            <MetricCard label="Revenue" value={formatCurrency(f.revenue)} />
            <MetricCard label="Rev. Growth" value={formatPercent(f.revenueGrowth)} highlight={f.revenueGrowth !== null && f.revenueGrowth > 0 ? "positive" : f.revenueGrowth !== null && f.revenueGrowth < 0 ? "negative" : undefined} />
            <MetricCard label="Gross Margin" value={formatPercent(f.grossMargin)} />
            <MetricCard label="Net Margin" value={formatPercent(f.netMargin)} />
            <MetricCard label="ROE" value={formatPercent(f.roe)} />
            <MetricCard label="ROIC" value={formatPercent(f.roic)} />
            <MetricCard label="Debt/Equity" value={formatRatio(f.debtToEquity)} />
            <MetricCard label="Beta" value={f.beta?.toFixed(2) || "N/A"} />
            <MetricCard label="Dividend Yield" value={f.dividendYield ? formatPercent(f.dividendYield) : "N/A"} />
            <MetricCard label="EPS" value={f.eps ? `$${f.eps.toFixed(2)}` : "N/A"} />
            <MetricCard label="FCF/Share" value={f.fcfPerShare ? `$${f.fcfPerShare.toFixed(2)}` : "N/A"} />
            <MetricCard label="P/B Ratio" value={formatRatio(f.pbRatio)} />
          </div>
        </div>

        {/* Revenue Trend */}
        {data.revenueTrend && data.revenueTrend.length > 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Revenue Trend</h2>
            <div className="space-y-2">
              {data.revenueTrend.map((point) => {
                const maxRev = Math.max(...data.revenueTrend!.map((p) => p.revenue));
                const widthPct = maxRev > 0 ? (point.revenue / maxRev) * 100 : 0;
                return (
                  <div key={point.date} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-20 flex-shrink-0">{point.date.slice(0, 4)}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="bg-blue-500 h-full rounded-full transition-all"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-600 w-20 text-right flex-shrink-0">
                      {formatCurrency(point.revenue)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Auth gate for AI report */}
        {!isSignedIn && !report && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-8 mb-4 text-center">
            <svg className="w-10 h-10 text-blue-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Sign up for the full research report</h3>
            <p className="text-sm text-gray-500 mb-4">
              Get AI-generated price targets, bull/bear scenarios, risk analysis, and buy/hold/sell recommendations.
            </p>
            <SignUpButton mode="modal">
              <button className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
                Sign Up Free
              </button>
            </SignUpButton>
          </div>
        )}

        {/* Price Targets */}
        {report && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Price Targets</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <PriceTargetCard
                label="Bull Case"
                target={report.bullCase}
                currentPrice={f.price}
                color="emerald"
              />
              <PriceTargetCard
                label="Base Case"
                target={report.baseCase}
                currentPrice={f.price}
                color="blue"
              />
              <PriceTargetCard
                label="Bear Case"
                target={report.bearCase}
                currentPrice={f.price}
                color="red"
              />
            </div>
            {/* Visual price range */}
            {f.price && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <PriceRangeBar
                  currentPrice={f.price}
                  bear={report.bearCase.targetPrice}
                  base={report.baseCase.targetPrice}
                  bull={report.bullCase.targetPrice}
                />
              </div>
            )}
          </div>
        )}

        {/* Risk Factors */}
        {report && report.riskFactors.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Risk Factors</h2>
            <div className="space-y-2">
              {report.riskFactors.map((risk, i) => (
                <div key={i} className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <p className="text-sm text-gray-600">{risk}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-center mt-6 mb-4">
          <p className="text-[10px] text-gray-300">
            This report is AI-generated for informational purposes only. Not financial advice.
            Data sourced from Financial Modeling Prep. Always do your own research.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function MetricCard({ label, value, highlight }: {
  label: string;
  value: string;
  highlight?: "positive" | "negative";
}) {
  const valueColor = highlight === "positive"
    ? "text-emerald-600"
    : highlight === "negative"
    ? "text-red-500"
    : "text-gray-900";

  return (
    <div className="p-3 bg-gray-50 rounded-lg">
      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${valueColor}`}>{value}</p>
    </div>
  );
}

function PriceTargetCard({ label, target, currentPrice, color }: {
  label: string;
  target: PriceTarget;
  currentPrice: number | null;
  color: "emerald" | "blue" | "red";
}) {
  const upside = currentPrice
    ? ((target.targetPrice - currentPrice) / currentPrice) * 100
    : null;

  const colorMap = {
    emerald: { bg: "bg-emerald-50", border: "border-emerald-100", accent: "text-emerald-600" },
    blue: { bg: "bg-blue-50", border: "border-blue-100", accent: "text-blue-600" },
    red: { bg: "bg-red-50", border: "border-red-100", accent: "text-red-600" },
  };
  const c = colorMap[color];

  return (
    <div className={`p-4 rounded-xl border ${c.bg} ${c.border}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        <span className="text-[10px] font-medium text-gray-400">{target.probability}% prob.</span>
      </div>
      <p className={`text-xl font-bold ${c.accent}`}>
        ${target.targetPrice.toFixed(2)}
      </p>
      {upside !== null && (
        <p className={`text-xs font-medium mt-1 ${upside >= 0 ? "text-emerald-500" : "text-red-500"}`}>
          {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% from current
        </p>
      )}
      <p className="text-xs text-gray-500 mt-2 leading-relaxed">{target.rationale}</p>
    </div>
  );
}

function PriceRangeBar({ currentPrice, bear, base, bull }: {
  currentPrice: number;
  bear: number;
  base: number;
  bull: number;
}) {
  const min = Math.min(bear, currentPrice) * 0.95;
  const max = Math.max(bull, currentPrice) * 1.05;
  const range = max - min;

  const pos = (val: number) => ((val - min) / range) * 100;

  return (
    <div className="relative h-10">
      {/* Track */}
      <div className="absolute top-4 left-0 right-0 h-2 bg-gray-100 rounded-full">
        <div
          className="absolute h-full bg-gradient-to-r from-red-200 via-blue-200 to-emerald-200 rounded-full"
          style={{ left: `${pos(bear)}%`, width: `${pos(bull) - pos(bear)}%` }}
        />
      </div>

      {/* Bear marker */}
      <div className="absolute top-2" style={{ left: `${pos(bear)}%`, transform: "translateX(-50%)" }}>
        <div className="w-2 h-6 bg-red-400 rounded-full" />
        <p className="text-[9px] text-red-400 mt-1 whitespace-nowrap">${bear.toFixed(0)}</p>
      </div>

      {/* Base marker */}
      <div className="absolute top-2" style={{ left: `${pos(base)}%`, transform: "translateX(-50%)" }}>
        <div className="w-2 h-6 bg-blue-400 rounded-full" />
        <p className="text-[9px] text-blue-400 mt-1 whitespace-nowrap">${base.toFixed(0)}</p>
      </div>

      {/* Bull marker */}
      <div className="absolute top-2" style={{ left: `${pos(bull)}%`, transform: "translateX(-50%)" }}>
        <div className="w-2 h-6 bg-emerald-400 rounded-full" />
        <p className="text-[9px] text-emerald-400 mt-1 whitespace-nowrap">${bull.toFixed(0)}</p>
      </div>

      {/* Current price marker */}
      <div className="absolute top-1" style={{ left: `${pos(currentPrice)}%`, transform: "translateX(-50%)" }}>
        <div className="w-3 h-3 bg-gray-900 rounded-full border-2 border-white shadow" />
        <p className="text-[9px] font-bold text-gray-900 mt-4 whitespace-nowrap">${currentPrice.toFixed(0)} now</p>
      </div>
    </div>
  );
}
