"use client";

import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { StructuredParameters } from "@/lib/types";

const METRIC_LABELS: Record<string, string> = {
  // ── Original metrics ──
  pe_ratio: "P/E Ratio",
  forward_pe: "Forward P/E",
  dividend_yield: "Dividend Yield",
  dividend_growth_years: "Dividend Growth Years",
  revenue_growth: "Revenue Growth (YoY)",
  earnings_growth: "Earnings Growth (YoY)",
  eps_growth_yoy: "EPS Growth (YoY)",
  revenue_growth_3yr_avg: "Revenue Growth (3yr Avg)",
  earnings_growth_3yr_avg: "Earnings Growth (3yr Avg)",
  revenue_growth_quarters: "Consec. Revenue Growth (Yrs)",
  consecutive_revenue_growth_years: "Consec. Revenue Growth (Yrs)",
  consecutive_earnings_growth_years: "Consec. Earnings Growth (Yrs)",
  consecutive_eps_growth_years: "Consec. EPS Growth (Yrs)",
  profit_margin: "Profit Margin",
  market_cap: "Market Cap ($B)",
  price_to_book: "Price to Book (P/B)",
  debt_to_equity: "Debt to Equity (D/E)",
  current_ratio: "Current Ratio",
  roe: "Return on Equity (ROE)",
  roic: "Return on Invested Capital (ROIC)",
  free_cash_flow_per_share: "Free Cash Flow / Share",
  payout_ratio: "Payout Ratio",
  beta: "Beta",
  week52_high_pct: "% of 52-Week High",
  sector: "Sector",
  // ── Key Metrics endpoint ──
  enterprise_value: "Enterprise Value",
  ev_to_sales: "EV / Sales",
  ev_to_operating_cash_flow: "EV / Operating Cash Flow",
  ev_to_free_cash_flow: "EV / Free Cash Flow",
  ev_to_ebitda: "EV / EBITDA",
  net_debt_to_ebitda: "Net Debt / EBITDA",
  income_quality: "Income Quality",
  graham_number: "Graham Number",
  graham_net_net: "Graham Net-Net",
  tax_burden: "Tax Burden",
  interest_burden: "Interest Burden",
  working_capital: "Working Capital",
  invested_capital: "Invested Capital",
  return_on_assets: "Return on Assets (ROA)",
  operating_return_on_assets: "Operating ROA",
  return_on_tangible_assets: "Return on Tangible Assets",
  return_on_capital_employed: "Return on Capital Employed (ROCE)",
  earnings_yield: "Earnings Yield",
  free_cash_flow_yield: "Free Cash Flow Yield",
  capex_to_operating_cash_flow: "CapEx / Operating Cash Flow",
  capex_to_depreciation: "CapEx / Depreciation",
  capex_to_revenue: "CapEx / Revenue",
  sga_to_revenue: "SG&A / Revenue",
  rd_to_revenue: "R&D / Revenue",
  sbc_to_revenue: "Stock-Based Comp / Revenue",
  intangibles_to_total_assets: "Intangibles / Total Assets",
  average_receivables: "Average Receivables",
  average_payables: "Average Payables",
  average_inventory: "Average Inventory",
  days_sales_outstanding: "Days Sales Outstanding",
  days_payables_outstanding: "Days Payables Outstanding",
  days_inventory_outstanding: "Days Inventory Outstanding",
  operating_cycle: "Operating Cycle (days)",
  cash_conversion_cycle: "Cash Conversion Cycle (days)",
  free_cash_flow_to_equity: "FCF to Equity",
  free_cash_flow_to_firm: "FCF to Firm",
  tangible_asset_value: "Tangible Asset Value",
  net_current_asset_value: "Net Current Asset Value",
  // ── Ratios endpoint ──
  gross_profit_margin: "Gross Profit Margin",
  ebit_margin: "EBIT Margin",
  ebitda_margin: "EBITDA Margin",
  operating_profit_margin: "Operating Profit Margin",
  pretax_profit_margin: "Pretax Profit Margin",
  continuous_operations_profit_margin: "Continuous Ops Profit Margin",
  net_profit_margin: "Net Profit Margin",
  bottom_line_profit_margin: "Bottom Line Profit Margin",
  receivables_turnover: "Receivables Turnover",
  payables_turnover: "Payables Turnover",
  inventory_turnover: "Inventory Turnover",
  fixed_asset_turnover: "Fixed Asset Turnover",
  asset_turnover: "Asset Turnover",
  quick_ratio: "Quick Ratio",
  solvency_ratio: "Solvency Ratio",
  cash_ratio: "Cash Ratio",
  peg_ratio: "PEG Ratio",
  forward_peg_ratio: "Forward PEG Ratio",
  price_to_fcf_ratio: "Price / FCF",
  price_to_ocf_ratio: "Price / Operating Cash Flow",
  debt_to_assets_ratio: "Debt / Assets",
  debt_to_capital_ratio: "Debt / Capital",
  lt_debt_to_capital_ratio: "Long-Term Debt / Capital",
  financial_leverage_ratio: "Financial Leverage Ratio",
  working_capital_turnover_ratio: "Working Capital Turnover",
  operating_cash_flow_ratio: "Operating Cash Flow Ratio",
  operating_cash_flow_sales_ratio: "OCF / Sales",
  fcf_to_ocf_ratio: "FCF / OCF",
  debt_service_coverage_ratio: "Debt Service Coverage",
  interest_coverage_ratio: "Interest Coverage",
  short_term_ocf_coverage_ratio: "Short-Term OCF Coverage",
  ocf_coverage_ratio: "OCF Coverage",
  capex_coverage_ratio: "CapEx Coverage",
  div_capex_coverage_ratio: "Dividend + CapEx Coverage",
  dividend_yield_percentage: "Dividend Yield (%)",
  interest_debt_per_share: "Interest Debt / Share",
  cash_per_share: "Cash / Share",
  book_value_per_share: "Book Value / Share",
  tangible_book_value_per_share: "Tangible Book Value / Share",
  shareholders_equity_per_share: "Shareholders Equity / Share",
  operating_cash_flow_per_share: "Operating Cash Flow / Share",
  capex_per_share: "CapEx / Share",
  net_income_per_ebt: "Net Income / EBT",
  ebt_per_ebit: "EBT / EBIT",
  price_to_fair_value: "Price / Fair Value",
  debt_to_market_cap: "Debt / Market Cap",
  effective_tax_rate: "Effective Tax Rate",
  enterprise_value_multiple: "Enterprise Value Multiple",
  revenue_per_share: "Revenue / Share",
  net_income_per_share: "Net Income / Share",
};

const OPERATOR_OPTIONS = [">", "<", ">=", "<=", "==", "between"];

const SECTOR_MAP: Record<string, number> = {
  Technology: 1,
  Healthcare: 2,
  Financial: 3,
  Energy: 4,
  Consumer: 5,
  Industrials: 6,
  "Basic Materials": 7,
  "Real Estate": 8,
  Utilities: 9,
  "Communication Services": 10,
};

const SECTOR_REVERSE: Record<number, string> = {
  1: "Technology",
  2: "Healthcare",
  3: "Financial",
  4: "Energy",
  5: "Consumer",
  6: "Industrials",
  7: "Basic Materials",
  8: "Real Estate",
  9: "Utilities",
  10: "Communication Services",
};

const PERCENTAGE_METRICS = new Set([
  "dividend_yield", "revenue_growth", "earnings_growth",
  "revenue_growth_3yr_avg", "earnings_growth_3yr_avg", "eps_growth_yoy",
  "profit_margin", "roe", "roic", "payout_ratio",
  "return_on_assets", "operating_return_on_assets", "return_on_tangible_assets",
  "return_on_capital_employed", "earnings_yield", "free_cash_flow_yield",
  "capex_to_operating_cash_flow", "capex_to_depreciation", "capex_to_revenue",
  "sga_to_revenue", "rd_to_revenue", "sbc_to_revenue", "intangibles_to_total_assets",
  "gross_profit_margin", "ebit_margin", "ebitda_margin", "operating_profit_margin",
  "pretax_profit_margin", "continuous_operations_profit_margin", "net_profit_margin",
  "bottom_line_profit_margin", "tax_burden", "interest_burden", "income_quality",
  "dividend_yield_percentage", "effective_tax_rate",
  "operating_cash_flow_sales_ratio", "fcf_to_ocf_ratio",
  "net_income_per_ebt", "ebt_per_ebit", "debt_to_market_cap",
  "week52_high_pct",
]);

function formatMetricValue(name: string, value: number): string {
  if (PERCENTAGE_METRICS.has(name)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (name === "market_cap") return `$${value}B`;
  if (name === "sector") return SECTOR_REVERSE[value] || String(value);
  if (name === "free_cash_flow_per_share") return `$${value.toFixed(2)}`;
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
        <button className="w-full flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-4 sm:px-6 py-4 hover:bg-gray-50 transition-colors min-h-[44px]">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 flex-shrink-0 ${open ? "rotate-90" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <h3 className="text-sm sm:text-lg font-semibold text-gray-900 truncate">View &amp; Edit Strategy Criteria</h3>
          </div>
          <span className="text-xs sm:text-sm text-gray-400 flex-shrink-0 ml-2">{edited.metrics.length} filter{edited.metrics.length !== 1 ? "s" : ""}</span>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out">
        <div className="bg-white rounded-b-2xl border border-t-0 border-gray-100 px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

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
                    className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
                  >
                    {Object.entries(METRIC_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>

                  {/* Operator */}
                  <select
                    value={metric.operator}
                    onChange={(e) => updateMetric(i, "operator", e.target.value)}
                    className="px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500 font-mono"
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
                    className="w-20 sm:w-24 px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
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
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Min ($B)</label>
                <input
                  type="number"
                  value={edited.market_cap.min ?? ""}
                  onChange={(e) => updateMarketCap("min", e.target.value)}
                  placeholder="Any"
                  className="w-24 sm:w-28 px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <span className="text-gray-300 hidden sm:inline">—</span>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Max ($B)</label>
                <input
                  type="number"
                  value={edited.market_cap.max ?? ""}
                  onChange={(e) => updateMarketCap("max", e.target.value)}
                  placeholder="Any"
                  className="w-24 sm:w-28 px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500"
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
