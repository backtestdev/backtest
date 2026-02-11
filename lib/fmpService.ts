/**
 * Stock Universe Service — PostgreSQL-backed
 *
 * Reads pre-populated stock data from the Neon PostgreSQL database
 * (tables: stocks, quotes, ratios, profiles) instead of making live
 * FMP API calls during requests.
 *
 * Data is populated offline via `npx tsx scripts/populate-stocks.ts`
 * and can be refreshed through the admin endpoint POST /api/admin/refresh-stocks.
 *
 * Maintains the same StockData interface so all downstream code
 * (stockData.ts, backtestEngine.ts, API routes) works unchanged.
 */

import { StockData } from './stockData';
import { getDb } from './db';

// In-memory cache — avoids repeated DB round-trips within a short window
const MEMORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let memoryCache: { stocks: StockData[]; timestamp: number } | null = null;

// Track last error for reporting to callers
let lastError: string | null = null;

// ---------------------------------------------------------------------------
// Sector mapping (same as before, applied during DB → StockData transform)
// ---------------------------------------------------------------------------

const SECTOR_MAP: Record<string, number> = {
  'Technology': 1,
  'Healthcare': 2,
  'Financial Services': 3,
  'Finance': 3,
  'Energy': 4,
  'Consumer Cyclical': 5,
  'Consumer Defensive': 5,
  'Industrials': 6,
  'Basic Materials': 7,
  'Real Estate': 8,
  'Utilities': 9,
  'Communication Services': 10,
};

// ---------------------------------------------------------------------------
// Core query — single JOIN across all four tables
// ---------------------------------------------------------------------------

async function queryStocksFromDb(): Promise<StockData[]> {
  const sql = getDb();
  if (!sql) {
    lastError = 'DATABASE_URL not configured';
    return [];
  }

  try {
    const rows = await sql`
      SELECT
        s.symbol,
        s.company_name,
        s.sector,
        s.market_cap  AS s_market_cap,
        s.beta,
        s.last_annual_dividend,

        q.price,
        q.pe,
        q.year_high,
        q.market_cap  AS q_market_cap,
        q.shares_outstanding,

        r.pb_ratio,
        r.dividend_yield,
        r.payout_ratio,
        r.roe,
        r.roic,
        r.debt_to_equity,
        r.current_ratio,
        r.free_cash_flow_per_share,

        p.revenue_growth,
        p.earnings_growth,
        p.revenue_growth_quarters,
        p.net_income_growth_quarters,
        p.dividend_growth_years,
        p.profit_margin,
        p.historical_returns
      FROM stocks s
      LEFT JOIN quotes  q ON q.symbol = s.symbol
      LEFT JOIN ratios  r ON r.symbol = s.symbol
      LEFT JOIN profiles p ON p.symbol = s.symbol
      WHERE s.is_actively_trading = true
        AND s.is_etf = false
      ORDER BY s.market_cap DESC
    `;

    lastError = null;
    return rows.map(toStockData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Missing tables means DB hasn't been populated yet — not a real error,
    // just return empty so the hardcoded fallback in stockData.ts kicks in.
    if (msg.includes('relation') && msg.includes('does not exist')) {
      lastError = 'Stock tables not yet created. Run POST /api/db/init then populate data.';
      console.warn('[FMP-DB] Stock tables not found — using fallback data');
      return [];
    }
    lastError = `Database query failed: ${msg}`;
    console.error('[FMP-DB]', lastError);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Row → StockData transform
// ---------------------------------------------------------------------------

function toStockData(row: Record<string, unknown>): StockData {
  const price = num(row.price);
  const yearHigh = num(row.year_high);
  const marketCapRaw = num(row.q_market_cap) || num(row.s_market_cap);
  const marketCapBillions = marketCapRaw / 1_000_000_000;

  // Compute dividend yield from last_annual_dividend if ratios row is missing
  const dividendYield =
    num(row.dividend_yield) ||
    (num(row.last_annual_dividend) && price > 0
      ? num(row.last_annual_dividend) / price
      : 0);

  return {
    ticker: String(row.symbol),
    name: String(row.company_name),
    sector: SECTOR_MAP[String(row.sector)] || 0,

    pe_ratio: num(row.pe),
    forward_pe: 0,
    price_to_book: num(row.pb_ratio),

    dividend_yield: dividendYield,
    dividend_growth_years: num(row.dividend_growth_years),
    payout_ratio: num(row.payout_ratio),

    revenue_growth: num(row.revenue_growth),
    revenue_growth_quarters: num(row.revenue_growth_quarters),
    net_income_growth_quarters: num(row.net_income_growth_quarters),
    earnings_growth: num(row.earnings_growth),

    profit_margin: num(row.profit_margin),
    roe: num(row.roe),
    roic: num(row.roic),

    debt_to_equity: num(row.debt_to_equity),
    current_ratio: num(row.current_ratio),
    free_cash_flow_per_share: num(row.free_cash_flow_per_share),

    market_cap: marketCapBillions,
    beta: num(row.beta),
    week52_high_pct: yearHigh > 0 ? price / yearHigh : 0,

    shares_outstanding: num(row.shares_outstanding),
    shares_change_pct: 0,
    ipo_date: '',

    historical_returns:
      row.historical_returns && typeof row.historical_returns === 'object'
        ? (row.historical_returns as Record<string, number>)
        : {},
  };
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Public API — same signatures as the old fmpService
// ---------------------------------------------------------------------------

/**
 * Returns cached stock universe from the database.
 * Uses 10-minute in-memory cache to avoid redundant DB queries.
 */
export async function getStockUniverse(): Promise<StockData[]> {
  // In-memory cache check
  if (memoryCache && Date.now() - memoryCache.timestamp < MEMORY_CACHE_TTL_MS) {
    console.log(`[FMP-DB] Serving ${memoryCache.stocks.length} stocks from memory cache`);
    return memoryCache.stocks;
  }

  console.log('[FMP-DB] Querying PostgreSQL for stock universe...');
  const stocks = await queryStocksFromDb();

  if (stocks.length > 0) {
    memoryCache = { stocks, timestamp: Date.now() };
    console.log(`[FMP-DB] Loaded ${stocks.length} stocks from database`);
  } else {
    console.warn('[FMP-DB] Database returned 0 stocks — caller should use fallback');
  }

  return stocks;
}

/**
 * Clears the in-memory cache so the next getStockUniverse() call
 * re-queries the database. Does NOT re-fetch from the FMP API —
 * use the admin endpoint or populate script for that.
 */
export async function refreshStockUniverse(): Promise<StockData[]> {
  console.log('[FMP-DB] Clearing memory cache, re-querying DB...');
  memoryCache = null;
  return getStockUniverse();
}

/**
 * Returns true if the database is configured (DATABASE_URL is set).
 */
export function isFMPConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Returns the last error message, if any.
 */
export function getLastFMPError(): string | null {
  return lastError;
}
