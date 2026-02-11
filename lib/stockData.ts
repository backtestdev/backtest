import { StockFilter } from "./types";
import { getStockUniverse as getFMPStockUniverse, getLastFMPError } from "./fmpService";

// Stock data sourced from Financial Modeling Prep /stable API with daily caching
export interface StockData {
  ticker: string;
  name: string;
  sector: number; // 1=tech, 2=healthcare, 3=finance, 4=energy, 5=consumer, etc.

  // Valuation metrics
  pe_ratio: number;
  forward_pe: number;
  price_to_book: number;
  price_to_sales?: number;
  price_to_fcf?: number;

  // Dividend metrics
  dividend_yield: number;
  dividend_growth_years: number;
  payout_ratio: number;

  // Growth metrics
  revenue_growth: number;
  revenue_growth_quarters: number;
  net_income_growth_quarters?: number;
  earnings_growth: number;

  // Profitability metrics
  profit_margin: number;
  gross_margin?: number;
  operating_margin?: number;
  roe: number;
  roic?: number;

  // Leverage & liquidity
  debt_to_equity: number;
  debt_to_assets?: number;
  current_ratio?: number;
  interest_coverage?: number;
  free_cash_flow_per_share?: number;

  // Market metrics
  market_cap: number; // in billions
  beta: number;
  week52_high_pct: number;

  // Share metrics
  eps?: number;
  shares_outstanding?: number;
  shares_change_pct?: number;

  // Other
  ipo_date?: string;

  // Historical annual returns for backtesting (derived from FMP ratios data)
  historical_returns: {
    [year: string]: number; // annual return as decimal
  };
}

export interface StockDatabaseResult {
  stocks: StockData[];
  dataSource: "fmp";
  stockCount: number;
}

/**
 * Gets the stock database from FMP API (cached daily).
 * Throws if FMP is unavailable — no fallback to hardcoded data.
 */
export async function getStockDatabase(): Promise<StockDatabaseResult> {
  const fmpStocks = await getFMPStockUniverse();
  if (fmpStocks && fmpStocks.length > 0) {
    console.log(`[StockData] Using FMP data: ${fmpStocks.length} stocks`);
    return { stocks: fmpStocks, dataSource: "fmp", stockCount: fmpStocks.length };
  }

  const fmpError = getLastFMPError();
  throw new Error(fmpError || "FMP API returned no data. Ensure FINANCIAL_MODELING_PREP_API_KEY is set.");
}

// S&P 500 (SPY) historical annual returns
const SPY_RETURNS: { [year: string]: number } = {
  "2024": 0.25, "2023": 0.26, "2022": -0.18, "2021": 0.29,
  "2020": 0.18, "2019": 0.31, "2018": -0.04, "2017": 0.22,
  "2016": 0.12, "2015": 0.01, "2014": 0.14, "2013": 0.32,
  "2012": 0.16, "2011": 0.02, "2010": 0.15, "2009": 0.26,
  "2008": -0.37, "2007": 0.05, "2006": 0.16, "2005": 0.05,
};

export function filterStocks(filters: StockFilter[], stocks: StockData[]): StockData[] {
  return stocks.filter((stock) => {
    return filters.every((filter) => {
      const value = stock[filter.metric as keyof StockData] as number;
      if (value === undefined || value === null) return false;

      switch (filter.operator) {
        case ">": return value > filter.value;
        case "<": return value < filter.value;
        case ">=": return value >= filter.value;
        case "<=": return value <= filter.value;
        case "==": return value === filter.value;
        case "between": return value >= filter.value && value <= (filter.valueEnd ?? filter.value);
        default: return false;
      }
    });
  });
}

export function getStockNames(stocks: StockData[]): string[] {
  return stocks.map((s) => `${s.ticker} (${s.name})`);
}

export function getStockTickers(stocks: StockData[]): string[] {
  return stocks.map((s) => s.ticker);
}

export function calculateReturns(
  stocks: StockData[],
  years: number
): { strategyReturn: number; benchmarkReturn: number; chartData: { date: string; strategy: number; benchmark: number }[] } {
  if (stocks.length === 0) {
    return { strategyReturn: 0, benchmarkReturn: 0, chartData: [] };
  }

  const currentYear = 2024;
  const startYear = currentYear - years + 1;
  const chartData: { date: string; strategy: number; benchmark: number }[] = [];

  let strategyValue = 10000;
  let benchmarkValue = 10000;

  for (let year = startYear; year <= currentYear; year++) {
    const yearStr = year.toString();

    // Strategy: equal-weight portfolio of matching stocks
    const availableStocks = stocks.filter((s) => s.historical_returns[yearStr] !== undefined && s.historical_returns[yearStr] !== 0);
    if (availableStocks.length > 0) {
      const avgReturn = availableStocks.reduce((sum, s) => sum + s.historical_returns[yearStr], 0) / availableStocks.length;
      strategyValue *= (1 + avgReturn);
    }

    // Benchmark: S&P 500
    const spyReturn = SPY_RETURNS[yearStr] ?? 0;
    benchmarkValue *= (1 + spyReturn);

    chartData.push({
      date: yearStr,
      strategy: Math.round(strategyValue),
      benchmark: Math.round(benchmarkValue),
    });
  }

  const strategyReturn = ((strategyValue - 10000) / 10000) * 100;
  const benchmarkReturn = ((benchmarkValue - 10000) / 10000) * 100;

  return { strategyReturn, benchmarkReturn, chartData };
}

export function getSpyReturn(years: number): number {
  const currentYear = 2024;
  const startYear = currentYear - years + 1;
  let value = 10000;

  for (let year = startYear; year <= currentYear; year++) {
    const yearStr = year.toString();
    const ret = SPY_RETURNS[yearStr] ?? 0;
    value *= (1 + ret);
  }

  return ((value - 10000) / 10000) * 100;
}
