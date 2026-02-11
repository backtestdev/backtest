import { BacktestResult, StrategyParameters, StockFilter, DebugInfo } from "./types";
import { filterStocks, getStockNames, calculateReturns, getStockDatabase } from "./stockData";

function formatMarketCapFilter(filter: StockFilter): string {
  const formatVal = (v: number) => {
    if (v >= 1000) return `$${(v / 1000).toFixed(1)}T`;
    if (v >= 1) return `$${v}B`;
    return `$${(v * 1000).toFixed(0)}M`;
  };
  if (filter.operator === "between") {
    return `Market cap ${formatVal(filter.value)} - ${formatVal(filter.valueEnd ?? filter.value)}`;
  }
  return `Market cap ${filter.operator} ${formatVal(filter.value)}`;
}

export async function runBacktest(params: StrategyParameters): Promise<BacktestResult> {
  // Get stock database (from FMP API with daily cache, or fallback to hardcoded data)
  const stockDatabase = await getStockDatabase();

  // Log applied filters for debugging
  const mcapFilters = params.filters.filter(f => f.metric === "market_cap");
  if (mcapFilters.length > 0) {
    for (const f of mcapFilters) {
      console.log(`[Backtest] ${formatMarketCapFilter(f)}`);
    }
  }

  const matchedStocks = filterStocks(params.filters, stockDatabase);

  // Log filtering results
  console.log(`[Backtest] Filtered to ${matchedStocks.length} stocks matching all criteria`);
  if (mcapFilters.length > 0 && matchedStocks.length > 0) {
    const sampleTickers = matchedStocks.slice(0, 10).map(s => `${s.ticker} ($${s.market_cap}B)`);
    console.log(`[Backtest] Sample matched stocks: ${sampleTickers.join(", ")}`);
  }

  // Build debug info
  const METRIC_LABELS: Record<string, string> = {
    pe_ratio: "P/E", forward_pe: "Forward P/E", dividend_yield: "Dividend yield",
    dividend_growth_years: "Dividend growth years", revenue_growth: "Revenue growth",
    revenue_growth_quarters: "Revenue growth quarters", earnings_growth: "Earnings growth",
    profit_margin: "Profit margin", market_cap: "Market cap", price_to_book: "P/B",
    debt_to_equity: "D/E", roe: "ROE", payout_ratio: "Payout ratio",
    beta: "Beta", week52_high_pct: "52-wk high %", sector: "Sector",
  };
  const SECTOR_NAMES: Record<number, string> = { 1: "Technology", 2: "Healthcare", 3: "Financial", 4: "Energy", 5: "Consumer" };

  const appliedFilters = params.filters.map(f => {
    if (f.metric === "market_cap") return formatMarketCapFilter(f);
    if (f.metric === "sector") return `Sector: ${SECTOR_NAMES[f.value] || f.value}`;
    const label = METRIC_LABELS[f.metric] || f.metric;
    const fmtVal = (v: number) => {
      if (["dividend_yield", "revenue_growth", "earnings_growth", "profit_margin", "roe", "payout_ratio"].includes(f.metric)) {
        return `${(v * 100).toFixed(1)}%`;
      }
      return String(v);
    };
    if (f.operator === "between") return `${label}: ${fmtVal(f.value)} - ${fmtVal(f.valueEnd ?? f.value)}`;
    return `${label} ${f.operator} ${fmtVal(f.value)}`;
  });

  const debugInfo: DebugInfo = {
    appliedFilters,
    matchedCount: matchedStocks.length,
    sampleTickers: matchedStocks.slice(0, 10).map(s => s.ticker),
  };

  if (matchedStocks.length === 0) {
    return {
      strategyName: params.description,
      description: params.description,
      matchedStocks: [],
      matchedStockCount: 0,
      timeHorizons: [],
      chartData: [],
      runDate: new Date().toISOString(),
      debugInfo,
    };
  }

  const periods = [
    { label: "1yr", years: 1 },
    { label: "5yr", years: 5 },
    { label: "10yr", years: 10 },
    { label: "20yr", years: 20 },
  ];

  const timeHorizons = periods.map(({ label, years }) => {
    const { strategyReturn, benchmarkReturn } = calculateReturns(matchedStocks, years);
    return {
      period: label,
      strategyReturn: Math.round(strategyReturn * 100) / 100,
      benchmarkReturn: Math.round(benchmarkReturn * 100) / 100,
      outperforms: strategyReturn > benchmarkReturn,
    };
  });

  // Get chart data for the longest available period (20yr)
  const { chartData } = calculateReturns(matchedStocks, 20);

  return {
    strategyName: params.description,
    description: params.description,
    matchedStocks: getStockNames(matchedStocks),
    matchedStockCount: matchedStocks.length,
    timeHorizons,
    chartData,
    runDate: new Date().toISOString(),
    debugInfo,
  };
}
