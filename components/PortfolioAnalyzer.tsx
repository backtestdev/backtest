"use client";

import { useState, useRef } from "react";

// ── Types ──

interface Holding {
  symbol: string;
  shares: number;
  costBasis?: number;
}

interface EnrichedHolding {
  symbol: string;
  name: string;
  shares: number;
  currentPrice: number;
  currentValue: number;
  costBasis: number | null;
  costBasisTotal: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  sector: string;
}

interface SectorBreakdown {
  sector: string;
  value: number;
  pct: number;
}

interface AnalysisResult {
  holdings: EnrichedHolding[];
  summary: {
    totalValue: number;
    totalCostBasis: number | null;
    totalGainLoss: number | null;
    holdingCount: number;
    weightedBeta: number;
    sectorBreakdown: SectorBreakdown[];
    concentrationRisk: { symbol: string; pct: number }[];
  };
  aiAnalysis: string | null;
  priceNote: string;
}

// ── Sector colors for allocation chart ──
const SECTOR_COLORS: Record<string, string> = {
  Technology: "bg-blue-500",
  Healthcare: "bg-emerald-500",
  Financial: "bg-amber-500",
  Energy: "bg-orange-500",
  Consumer: "bg-pink-500",
  Industrials: "bg-gray-500",
  "Basic Materials": "bg-yellow-600",
  "Real Estate": "bg-purple-500",
  Utilities: "bg-teal-500",
  "Communication Services": "bg-indigo-500",
  Unknown: "bg-gray-300",
  Other: "bg-gray-400",
};

// ── Sub-components ──

function formatCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function HoldingEntryRow({
  holding,
  onUpdate,
  onRemove,
}: {
  holding: Holding;
  onUpdate: (h: Holding) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="text"
        value={holding.symbol}
        onChange={(e) => onUpdate({ ...holding, symbol: e.target.value.toUpperCase() })}
        placeholder="AAPL"
        className="w-24 px-3 py-2 text-sm font-mono bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 uppercase"
      />
      <input
        type="number"
        value={holding.shares || ""}
        onChange={(e) => onUpdate({ ...holding, shares: Number(e.target.value) || 0 })}
        placeholder="Shares"
        className="w-24 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
      />
      <input
        type="number"
        value={holding.costBasis || ""}
        onChange={(e) => onUpdate({ ...holding, costBasis: Number(e.target.value) || undefined })}
        placeholder="Avg cost"
        step="0.01"
        className="w-28 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
      />
      <button
        onClick={onRemove}
        className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
        title="Remove"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function SectorBar({ breakdown }: { breakdown: SectorBreakdown[] }) {
  return (
    <div>
      <div className="flex rounded-lg overflow-hidden h-5">
        {breakdown.map((s) => (
          <div
            key={s.sector}
            className={`${SECTOR_COLORS[s.sector] || "bg-gray-300"} transition-all`}
            style={{ width: `${Math.max(s.pct * 100, 1)}%` }}
            title={`${s.sector}: ${(s.pct * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {breakdown.map((s) => (
          <div key={s.sector} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${SECTOR_COLORS[s.sector] || "bg-gray-300"}`} />
            <span className="text-xs text-gray-500">
              {s.sector} {(s.pct * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──

export default function PortfolioAnalyzer() {
  const [holdings, setHoldings] = useState<Holding[]>([{ symbol: "", shares: 0 }]);
  const [profile, setProfile] = useState<{ age?: number; riskTolerance?: string }>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateHolding = (index: number, h: Holding) => {
    const updated = [...holdings];
    updated[index] = h;
    setHoldings(updated);
  };

  const removeHolding = (index: number) => {
    if (holdings.length === 1) return;
    setHoldings(holdings.filter((_, i) => i !== index));
  };

  const addHolding = () => {
    setHoldings([...holdings, { symbol: "", shares: 0 }]);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/portfolio/parse-image", { method: "POST", body: formData });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.holdings && data.holdings.length > 0) {
        setHoldings(data.holdings.map((h: Holding) => ({
          symbol: h.symbol?.toUpperCase() || "",
          shares: h.shares || 0,
          costBasis: h.costBasis || undefined,
        })));
      } else {
        setError("Could not identify any holdings in the image. Try a clearer screenshot.");
      }
    } catch {
      setError("Failed to parse image. Please try again.");
    } finally {
      setImageLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const analyze = async () => {
    const validHoldings = holdings.filter((h) => h.symbol.trim() && h.shares > 0);
    if (validHoldings.length === 0) {
      setError("Add at least one holding with a ticker and shares.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/portfolio/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: validHoldings, profile }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch {
      setError("Failed to analyze portfolio. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Portfolio Analyzer</h1>
        <p className="mt-2 text-gray-400">
          Enter your holdings for a full analysis with diversification, risk assessment, and AI-powered recommendations.
        </p>

        {/* Input section */}
        <div className="mt-8 bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Your Holdings</h2>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={imageLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {imageLoading ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Parsing...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                    </svg>
                    Upload screenshot
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-3 mb-2 pl-0">
            <span className="w-24 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Ticker</span>
            <span className="w-24 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Shares</span>
            <span className="w-28 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Avg Cost (opt)</span>
          </div>

          {/* Holdings list */}
          <div className="space-y-2">
            {holdings.map((h, i) => (
              <HoldingEntryRow
                key={i}
                holding={h}
                onUpdate={(updated) => updateHolding(i, updated)}
                onRemove={() => removeHolding(i)}
              />
            ))}
          </div>

          <button
            onClick={addHolding}
            className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add another
          </button>

          {/* Profile (optional) */}
          <div className="mt-6 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
              Optional: About you (for personalized advice)
            </p>
            <div className="flex items-center gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Age</label>
                <input
                  type="number"
                  value={profile.age || ""}
                  onChange={(e) => setProfile({ ...profile, age: Number(e.target.value) || undefined })}
                  placeholder="30"
                  className="w-20 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Risk tolerance</label>
                <select
                  value={profile.riskTolerance || ""}
                  onChange={(e) => setProfile({ ...profile, riskTolerance: e.target.value || undefined })}
                  className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 text-gray-700"
                >
                  <option value="">Select...</option>
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </div>
            </div>
          </div>

          {/* Analyze button */}
          <button
            onClick={analyze}
            disabled={loading || holdings.every((h) => !h.symbol.trim() || h.shares <= 0)}
            className="mt-6 w-full py-3 px-6 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analyzing...
              </>
            ) : (
              "Analyze Portfolio"
            )}
          </button>

          {error && (
            <p className="mt-3 text-sm text-red-500 text-center">{error}</p>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="mt-8 space-y-6 animate-in fade-in duration-500">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wider">Total Value</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(result.summary.totalValue)}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wider">Holdings</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{result.summary.holdingCount}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wider">Portfolio Beta</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{result.summary.weightedBeta.toFixed(2)}</p>
              </div>
              {result.summary.totalGainLoss !== null && (
                <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Total Gain/Loss</p>
                  <p className={`text-2xl font-bold mt-1 ${
                    result.summary.totalGainLoss >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}>
                    {result.summary.totalGainLoss >= 0 ? "+" : ""}
                    {formatCurrency(result.summary.totalGainLoss)}
                  </p>
                </div>
              )}
            </div>

            {/* Sector allocation */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Sector Allocation</h3>
              <SectorBar breakdown={result.summary.sectorBreakdown} />
            </div>

            {/* Holdings table */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">Holdings Detail</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {result.holdings.map((h) => (
                  <div key={h.symbol} className="grid grid-cols-12 gap-2 px-6 py-3 items-center">
                    <div className="col-span-3 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{h.symbol}</p>
                      <p className="text-xs text-gray-400 truncate">{h.name}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <p className="text-sm text-gray-600">{h.shares} shares</p>
                      <p className="text-xs text-gray-400">${h.currentPrice.toFixed(2)}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <p className="text-sm font-medium text-gray-900">{formatCurrency(h.currentValue)}</p>
                      <p className="text-xs text-gray-400">
                        {result.summary.totalValue > 0
                          ? `${((h.currentValue / result.summary.totalValue) * 100).toFixed(1)}%`
                          : ""}
                      </p>
                    </div>
                    <div className="col-span-2 text-right">
                      {h.gainLoss !== null ? (
                        <>
                          <p className={`text-sm font-medium ${h.gainLoss >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {h.gainLoss >= 0 ? "+" : ""}{formatCurrency(h.gainLoss)}
                          </p>
                          <p className={`text-xs ${(h.gainLossPct ?? 0) >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                            {(h.gainLossPct ?? 0) >= 0 ? "+" : ""}{((h.gainLossPct ?? 0) * 100).toFixed(1)}%
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-gray-300">No cost basis</span>
                      )}
                    </div>
                    <div className="col-span-3 text-right">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        {h.sector}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Analysis */}
            {result.aiAnalysis && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  AI Analysis
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                    Beta
                  </span>
                </h3>
                <div className="text-sm text-gray-600 leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1 [&_strong]:text-gray-800 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-gray-800 [&_h2]:mt-3 [&_h2]:mb-1 whitespace-pre-line">
                  {result.aiAnalysis}
                </div>
              </div>
            )}

            {/* Price note */}
            <p className="text-xs text-gray-300 text-center">{result.priceNote}</p>
          </div>
        )}
      </div>
    </div>
  );
}
