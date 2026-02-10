"use client";

import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { StructuredParameters } from "@/lib/types";

const METRIC_LABELS: Record<string, string> = {
  pe_ratio: "P/E Ratio",
  forward_pe: "Forward P/E",
  dividend_yield: "Dividend Yield",
  dividend_growth_years: "Dividend Growth Years",
  revenue_growth: "Revenue Growth",
  revenue_growth_quarters: "Revenue Growth Quarters",
  earnings_growth: "Earnings Growth",
  profit_margin: "Profit Margin",
  market_cap: "Market Cap ($B)",
  price_to_book: "Price to Book",
  debt_to_equity: "Debt to Equity",
  roe: "Return on Equity",
  payout_ratio: "Payout Ratio",
  beta: "Beta",
  week52_high_pct: "% of 52-Week High",
  sector: "Sector",
};

const OPERATOR_OPTIONS = [">", "<", ">=", "<=", "==", "between"];

const SECTOR_MAP: Record<string, number> = {
  Technology: 1,
  Healthcare: 2,
  Financial: 3,
  Energy: 4,
  Consumer: 5,
};

const SECTOR_REVERSE: Record<number, string> = {
  1: "Technology",
  2: "Healthcare",
  3: "Financial",
  4: "Energy",
  5: "Consumer",
};

function formatMetricValue(name: string, value: number): string {
  if (name === "dividend_yield" || name === "revenue_growth" || name === "earnings_growth" || name === "profit_margin" || name === "roe" || name === "payout_ratio") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (name === "market_cap") return `$${value}B`;
  if (name === "sector") return SECTOR_REVERSE[value] || String(value);
  return String(value);
}

interface StrategyInspectorProps {
  params: StructuredParameters;
  onUpdate: (params: StructuredParameters) => void;
  isLoading: boolean;
}

export default function StrategyInspector({ params, onUpdate, isLoading }: StrategyInspectorProps) {
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState<StructuredParameters>(JSON.parse(JSON.stringify(params)));
  const [hasEdits, setHasEdits] = useState(false);

  const updateMetric = (index: number, field: string, value: string | number) => {
    const updated = { ...edited, metrics: [...edited.metrics] };
    updated.metrics[index] = { ...updated.metrics[index], [field]: value };
    setEdited(updated);
    setHasEdits(true);
  };

  const removeMetric = (index: number) => {
    const updated = { ...edited, metrics: edited.metrics.filter((_, i) => i !== index) };
    setEdited(updated);
    setHasEdits(true);
  };

  const addMetric = () => {
    const updated = {
      ...edited,
      metrics: [...edited.metrics, { name: "pe_ratio", operator: "<", value: 20 }],
    };
    setEdited(updated);
    setHasEdits(true);
  };

  const updateMarketCap = (field: "min" | "max", value: string) => {
    const updated = {
      ...edited,
      market_cap: { ...edited.market_cap, [field]: value === "" ? null : Number(value) },
    };
    setEdited(updated);
    setHasEdits(true);
  };

  const toggleSector = (sector: string, type: "include" | "exclude") => {
    const updated = { ...edited, sectors: { ...edited.sectors } };
    const list = [...updated.sectors[type]];
    const idx = list.indexOf(sector);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(sector);
    }
    updated.sectors[type] = list;
    setEdited(updated);
    setHasEdits(true);
  };

  const handleUpdate = () => {
    onUpdate(edited);
  };

  const resetEdits = () => {
    setEdited(JSON.parse(JSON.stringify(params)));
    setHasEdits(false);
  };

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-6">
      <Collapsible.Trigger asChild>
        <button className="w-full flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-6 py-4 hover:bg-gray-50 transition-colors">
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-900">View &amp; Edit Strategy Criteria</h3>
          </div>
          <span className="text-sm text-gray-400">{edited.metrics.length} filter{edited.metrics.length !== 1 ? "s" : ""}</span>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out">
        <div className="bg-white rounded-b-2xl border border-t-0 border-gray-100 px-6 py-6 space-y-6">

          {/* Side-by-side comparison header */}
          {hasEdits && (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-medium">Original (from AI)</span>
              <span className="text-gray-300">vs</span>
              <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">Your Adjustments</span>
            </div>
          )}

          {/* Metrics filters - query builder style */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Filters</h4>
              <button
                onClick={addMetric}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add filter
              </button>
            </div>

            {edited.metrics.map((metric, i) => {
              const original = params.metrics[i];
              const isChanged = hasEdits && original && (
                metric.name !== original.name ||
                metric.operator !== original.operator ||
                metric.value !== original.value
              );

              return (
                <div
                  key={i}
                  className={`flex flex-wrap items-center gap-2 p-3 rounded-xl border ${
                    isChanged ? "border-amber-200 bg-amber-50/50" : "border-gray-100 bg-gray-50/50"
                  }`}
                >
                  {/* Metric name */}
                  <select
                    value={metric.name}
                    onChange={(e) => updateMetric(i, "name", e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
                  >
                    {Object.entries(METRIC_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>

                  {/* Operator */}
                  <select
                    value={metric.operator}
                    onChange={(e) => updateMetric(i, "operator", e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500 font-mono"
                  >
                    {OPERATOR_OPTIONS.map((op) => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>

                  {/* Value */}
                  <input
                    type="number"
                    value={metric.value}
                    onChange={(e) => updateMetric(i, "value", Number(e.target.value))}
                    className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
                    step="any"
                  />

                  {/* Between end value */}
                  {metric.operator === "between" && (
                    <>
                      <span className="text-sm text-gray-400">and</span>
                      <input
                        type="number"
                        value={metric.valueEnd ?? ""}
                        onChange={(e) => updateMetric(i, "valueEnd", Number(e.target.value))}
                        className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
                        step="any"
                      />
                    </>
                  )}

                  {/* Original value indicator */}
                  {isChanged && original && (
                    <span className="text-xs text-gray-400">
                      was: {formatMetricValue(original.name, original.value)}
                    </span>
                  )}

                  {/* Remove button */}
                  <button
                    onClick={() => removeMetric(i)}
                    className="ml-auto p-1 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Market cap range */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Market Cap Range</h4>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Min ($B)</label>
                <input
                  type="number"
                  value={edited.market_cap.min ?? ""}
                  onChange={(e) => updateMarketCap("min", e.target.value)}
                  placeholder="Any"
                  className="w-28 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <span className="text-gray-300">—</span>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Max ($B)</label>
                <input
                  type="number"
                  value={edited.market_cap.max ?? ""}
                  onChange={(e) => updateMarketCap("max", e.target.value)}
                  placeholder="Any"
                  className="w-28 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Sector filters */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Sectors</h4>
            <div className="flex flex-wrap gap-2">
              {Object.keys(SECTOR_MAP).map((sector) => {
                const isIncluded = edited.sectors.include.includes(sector);
                const isExcluded = edited.sectors.exclude.includes(sector);
                return (
                  <div key={sector} className="flex items-center gap-1">
                    <button
                      onClick={() => toggleSector(sector, "include")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        isIncluded
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                    >
                      {sector}
                    </button>
                    {isExcluded && (
                      <button
                        onClick={() => toggleSector(sector, "exclude")}
                        className="text-xs text-red-400 hover:text-red-600"
                        title="Click to remove exclusion"
                      >
                        excluded
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400">Click to include a sector. Unselected sectors are not filtered.</p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={handleUpdate}
              disabled={isLoading}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Updating...
                </>
              ) : (
                "Update Results"
              )}
            </button>
            {hasEdits && (
              <button
                onClick={resetEdits}
                className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Reset to Original
              </button>
            )}
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
