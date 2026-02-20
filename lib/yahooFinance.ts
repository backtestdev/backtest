/**
 * Yahoo Finance Service — Historical Price Data
 *
 * Uses yahoo-finance2 (v3) chart API to fetch historical monthly prices
 * and compute annual returns for backtesting. Provides 20+ years of data,
 * far exceeding the 5-year limit of the FMP starter plan.
 *
 * Annual return for year Y = (Dec close Y / Dec close Y-1) - 1
 * Uses adjusted close prices to account for splits and dividends.
 */

import YahooFinance from "yahoo-finance2";

// Single instance, suppress the historical→chart migration notice
const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

export interface AnnualReturn {
  year: number;
  annualReturn: number; // decimal (e.g. 0.33 = 33%)
  yearEndClose: number;
}

export interface MonthlyPrice {
  date: string;  // "2025-07-15"
  close: number;
}

export interface PriceResult {
  annualReturns: AnnualReturn[];
  monthlyPrices: MonthlyPrice[];
}

/**
 * Fetches monthly chart data from Yahoo Finance and computes
 * annual returns for a given stock symbol. Also returns raw monthly
 * close prices for storage in stock_prices.
 *
 * @param symbol - Ticker symbol (e.g. "AAPL", "SPY")
 * @param years - Number of years of history to fetch (default 21)
 * @returns Annual returns and monthly close prices
 */
export async function fetchAnnualReturns(
  symbol: string,
  years: number = 21
): Promise<PriceResult> {
  const endDate = new Date();
  const startDate = new Date();
  // Fetch one extra year so we have a baseline for the first year's return
  startDate.setFullYear(startDate.getFullYear() - years - 1);

  const result = await yf.chart(symbol, {
    period1: startDate,
    period2: endDate,
    interval: "1mo",
  });

  if (!result || !result.quotes || result.quotes.length === 0) {
    return { annualReturns: [], monthlyPrices: [] };
  }

  // Collect monthly close prices for stock_prices table
  const monthlyPrices: MonthlyPrice[] = [];

  // Find the last close price for each year (December or last available month)
  // Prefer adjclose for split/dividend-adjusted total returns
  const yearEndCloses = new Map<number, { month: number; close: number }>();

  for (const row of result.quotes) {
    const year = row.date.getFullYear();
    const month = row.date.getMonth(); // 0-indexed
    const close = row.adjclose ?? row.close;

    if (close == null || close <= 0) continue;

    // Store monthly price
    monthlyPrices.push({
      date: row.date.toISOString().slice(0, 10),
      close: Math.round(close * 100) / 100,
    });

    const existing = yearEndCloses.get(year);
    if (!existing || month > existing.month) {
      yearEndCloses.set(year, { month, close });
    }
  }

  // Compute year-over-year returns
  const sortedYears = Array.from(yearEndCloses.keys()).sort((a, b) => a - b);
  const annualReturns: AnnualReturn[] = [];

  for (let i = 1; i < sortedYears.length; i++) {
    const year = sortedYears[i];
    const prevClose = yearEndCloses.get(sortedYears[i - 1])!.close;
    const currClose = yearEndCloses.get(year)!.close;

    if (prevClose > 0) {
      annualReturns.push({
        year,
        annualReturn:
          Math.round(((currClose - prevClose) / prevClose) * 1e6) / 1e6,
        yearEndClose: Math.round(currClose * 100) / 100,
      });
    }
  }

  return { annualReturns, monthlyPrices };
}

/**
 * Fetches annual returns for multiple symbols with concurrency control.
 * Handles rate limiting and errors gracefully — failed symbols are
 * skipped without affecting the rest.
 *
 * @param symbols - Array of ticker symbols
 * @param concurrency - Max parallel requests (default 5)
 * @param years - Years of history (default 21)
 * @param onProgress - Optional progress callback
 * @returns Map of symbol → annual returns
 */
export async function fetchBulkAnnualReturns(
  symbols: string[],
  concurrency: number = 5,
  years: number = 21,
  onProgress?: (
    done: number,
    total: number,
    symbol: string,
    ok: boolean
  ) => void
): Promise<Map<string, PriceResult>> {
  const results = new Map<string, PriceResult>();
  let completed = 0;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchAnnualReturns(symbol, years);
        return { symbol, data };
      })
    );

    for (const result of batchResults) {
      completed++;
      if (result.status === "fulfilled" && result.value.data.annualReturns.length > 0) {
        results.set(result.value.symbol, result.value.data);
        onProgress?.(completed, symbols.length, result.value.symbol, true);
      } else {
        const sym =
          result.status === "fulfilled" ? result.value.symbol : "unknown";
        onProgress?.(completed, symbols.length, sym, false);
      }
    }

    // Small delay between batches to be respectful to Yahoo Finance
    if (i + concurrency < symbols.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}
