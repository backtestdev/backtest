import { BacktestResult, StrategyParameters, StockFilter, DebugInfo } from "./types";
import { filterStocks, getStockNames, calculateReturns, getStockDatabase } from "./stockData";
import { loadReturnsForTickers } from "./fmpService";

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
  const { stocks: stockDatabase, dataSource, stockCount: stockUniverseSize, error: stockSourceError } = await getStockDatabase();

  // Log applied filters for debugging
  const mcapFilters = params.filters.filter(f => f.metric === "market_cap");
  if (mcapFilters.length > 0) {
    for (const f of mcapFilters) {
      console.log(`[Backtest] ${formatMarketCapFilter(f)}`);
    }
  }

  // Use ticker-based selection when GPT returns specific tickers (non-metric queries)
  let matchedStocks;
  const tickerWarnings: string[] = [];
  if (params.tickers && params.tickers.length > 0) {
    const allByTicker = stockDatabase.filter(s => params.tickers!.includes(s.ticker));
    const notFound = params.tickers.filter(t => !allByTicker.some(s => s.ticker === t));
    if (notFound.length > 0) {
      tickerWarnings.push(`${notFound.length} ticker(s) not in database: ${notFound.slice(0, 10).join(", ")}${notFound.length > 10 ? "..." : ""}`);
      console.log(`[Backtest] Tickers not in DB: ${notFound.join(", ")}`);
    }

    // Always load fresh returns from DB for ticker-selected stocks.
    // The in-memory cache may have stale/empty returns (e.g., cache loaded before price refresh).
    // IMPORTANT: create shallow copies — never mutate the cached stock objects.
    const tickerList = allByTicker.map(s => s.ticker);
    console.log(`[Backtest] Loading returns from DB for ${tickerList.length} tickers`);
    const dbReturns = await loadReturnsForTickers(tickerList);
    console.log(`[Backtest] DB returned returns for ${dbReturns.size}/${tickerList.length} tickers`);

    const stocksWithReturns = allByTicker.map(s => {
      const freshReturns = dbReturns.get(s.ticker);
      if (freshReturns && Object.keys(freshReturns).length > 0) {
        // Shallow copy with fresh DB returns — don't mutate cache
        return { ...s, historical_returns: freshReturns };
      }
      // Keep original (may already have returns from cache attach)
      return { ...s };
    });

    const withReturns = stocksWithReturns.filter(s => Object.keys(s.historical_returns).length > 0);
    const noReturns = stocksWithReturns.filter(s => Object.keys(s.historical_returns).length === 0);
    if (noReturns.length > 0) {
      tickerWarnings.push(`${noReturns.length} stock(s) found but had no price history: ${noReturns.map(s => s.ticker).join(", ")}`);
      console.log(`[Backtest] Tickers with no returns: ${noReturns.map(s => s.ticker).join(", ")}`);
    }
    matchedStocks = withReturns;
    console.log(`[Backtest] Ticker selection: ${params.tickers.length} requested → ${allByTicker.length} found → ${withReturns.length} with returns`);
  } else {
    matchedStocks = filterStocks(params.filters, stockDatabase);
  }

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
    debt_to_equity: "D/E", current_ratio: "Current ratio", roe: "ROE", roic: "ROIC",
    free_cash_flow_per_share: "FCF/share", payout_ratio: "Payout ratio",
    revenue_per_share: "Revenue/share", net_income_per_share: "Net income/share",
    beta: "Beta", week52_high_pct: "52-wk high %", sector: "Sector",
  };
  const SECTOR_NAMES: Record<number, string> = {
    1: "Technology", 2: "Healthcare", 3: "Financial", 4: "Energy", 5: "Consumer",
    6: "Industrials", 7: "Basic Materials", 8: "Real Estate", 9: "Utilities", 10: "Communication Services",
  };

  const appliedFilters = params.filters.map(f => {
    if (f.metric === "market_cap") return formatMarketCapFilter(f);
    if (f.metric === "sector") return `Sector: ${SECTOR_NAMES[f.value] || f.value}`;
    const label = METRIC_LABELS[f.metric] || f.metric;
    const fmtVal = (v: number) => {
      if (["dividend_yield", "revenue_growth", "earnings_growth", "profit_margin", "roe", "roic", "payout_ratio"].includes(f.metric)) {
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
      dataSource,
      stockUniverseSize,
      stockSourceError,
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

  // Get chart data for the longest available period (20yr), including current year YTD
  const { chartData } = calculateReturns(matchedStocks, 20, { includeYtd: true });

  return {
    strategyName: params.description,
    description: params.description,
    matchedStocks: getStockNames(matchedStocks),
    matchedStockCount: matchedStocks.length,
    warnings: tickerWarnings.length > 0 ? tickerWarnings : undefined,
    timeHorizons,
    chartData,
    runDate: new Date().toISOString(),
    debugInfo,
    dataSource,
    stockUniverseSize,
    stockSourceError,
  };
}
