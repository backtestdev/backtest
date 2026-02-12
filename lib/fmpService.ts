/**
 * Stock Universe Service — PostgreSQL-backed
 *
 * Reads pre-populated stock data from the Neon PostgreSQL database
 * (single unified `stocks` table) instead of making live FMP API calls
 * during requests.
 *
 * Data is populated via POST /api/admin/refresh-data which uses bulk
 * FMP API calls (screener + ratios-ttm-bulk + key-metrics-ttm-bulk).
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
// Sector mapping (applied during DB → StockData transform)
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
// Core query — single unified stocks table, no JOINs
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
        symbol,
        company_name,
        sector,
        industry,
        market_cap,
        price,
        beta,
        volume,
        avg_volume,
        last_dividend,
        is_etf,
        is_actively_trading,

        -- Valuation
        price_to_earnings_ratio,
        price_to_earnings_growth_ratio,
        price_to_book_ratio,
        price_to_sales_ratio,
        price_to_free_cash_flow_ratio,
        price_to_operating_cash_flow_ratio,
        price_to_fair_value,
        enterprise_value_multiple,

        -- Profitability
        gross_profit_margin,
        ebit_margin,
        ebitda_margin,
        operating_profit_margin,
        pretax_profit_margin,
        net_profit_margin,
        effective_tax_rate,

        -- Returns
        return_on_assets,
        return_on_equity,
        return_on_invested_capital,
        return_on_capital_employed,
        earnings_yield,
        free_cash_flow_yield,

        -- Liquidity & Solvency
        current_ratio,
        quick_ratio,
        cash_ratio,

        -- Leverage/Debt
        debt_to_equity_ratio,
        debt_to_assets_ratio,
        debt_to_capital_ratio,
        financial_leverage_ratio,
        debt_to_market_cap,
        interest_coverage_ratio,

        -- Dividends
        dividend_yield,
        dividend_yield_percentage,
        dividend_payout_ratio,

        -- Per share
        revenue_per_share,
        net_income_per_share,
        book_value_per_share,
        tangible_book_value_per_share,
        operating_cash_flow_per_share,
        free_cash_flow_per_share,
        cash_per_share,

        -- Efficiency
        asset_turnover,
        inventory_turnover,
        receivables_turnover,
        days_of_sales_outstanding,
        days_of_inventory_outstanding,
        days_of_payables_outstanding,
        cash_conversion_cycle,

        -- Enterprise Value
        enterprise_value,
        ev_to_sales,
        ev_to_ebitda,
        ev_to_operating_cash_flow,
        ev_to_free_cash_flow,
        net_debt_to_ebitda,

        -- Cash Flow
        capex_to_revenue,
        free_cash_flow_operating_cash_flow_ratio,
        operating_cash_flow_sales_ratio,
        income_quality,

        -- Other
        graham_number,
        working_capital,
        invested_capital,
        tangible_asset_value,
        research_and_development_to_revenue,
        stock_based_compensation_to_revenue,

        -- Trend data
        consecutive_dividend_growth_years,
        consecutive_revenue_growth_years,
        consecutive_net_income_growth_years,
        revenue_growth_3yr_avg,
        net_income_growth_3yr_avg

      FROM stocks
      WHERE is_actively_trading = true
        AND is_etf = false
      ORDER BY market_cap DESC
    `;

    lastError = null;
    return rows.map(toStockData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Missing tables means DB hasn't been populated yet — not a real error,
    // just return empty so the hardcoded fallback in stockData.ts kicks in.
    if (msg.includes('relation') && msg.includes('does not exist')) {
      lastError = 'Stock tables not yet created. Run POST /api/db/init then POST /api/admin/refresh-data.';
      console.warn('[FMP-DB] Stock tables not found — using fallback data');
      return [];
    }
    // Column not found means old schema — need to run refresh-data
    if (msg.includes('column') && msg.includes('does not exist')) {
      lastError = 'Stock table has old schema. Run POST /api/admin/refresh-data to migrate.';
      console.warn('[FMP-DB] Old schema detected — using fallback data');
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
  const marketCapRaw = num(row.market_cap);
  const marketCapBillions = marketCapRaw / 1_000_000_000;

  // Compute dividend yield from last_dividend if dividend_yield column is null
  const dividendYield =
    num(row.dividend_yield) ||
    (num(row.last_dividend) && price > 0
      ? num(row.last_dividend) / price
      : 0);

  return {
    ticker: String(row.symbol),
    name: String(row.company_name || ''),
    sector: SECTOR_MAP[String(row.sector)] || 0,

    // Valuation
    pe_ratio: num(row.price_to_earnings_ratio),
    forward_pe: 0,
    price_to_book: num(row.price_to_book_ratio),

    // Dividends
    dividend_yield: dividendYield,
    dividend_growth_years: num(row.consecutive_dividend_growth_years),
    payout_ratio: num(row.dividend_payout_ratio),

    // Growth
    revenue_growth: num(row.revenue_growth_3yr_avg),
    revenue_growth_quarters: num(row.consecutive_revenue_growth_years),
    net_income_growth_quarters: num(row.consecutive_net_income_growth_years),
    earnings_growth: num(row.net_income_growth_3yr_avg),

    // Profitability
    profit_margin: num(row.net_profit_margin),
    roe: num(row.return_on_equity),
    roic: num(row.return_on_invested_capital),

    // Leverage & liquidity
    debt_to_equity: num(row.debt_to_equity_ratio),
    current_ratio: num(row.current_ratio),
    free_cash_flow_per_share: num(row.free_cash_flow_per_share),

    // Per-share
    revenue_per_share: num(row.revenue_per_share),
    net_income_per_share: num(row.net_income_per_share),

    // Market
    market_cap: marketCapBillions,
    beta: num(row.beta),
    week52_high_pct: 0, // Not stored in unified table

    // Share metrics
    shares_outstanding: 0,
    shares_change_pct: 0,

    // Historical returns — not in the unified table yet, empty for now
    historical_returns: {},

    // Enterprise value / EV metrics
    enterprise_value: num(row.enterprise_value),
    ev_to_sales: num(row.ev_to_sales),
    ev_to_operating_cash_flow: num(row.ev_to_operating_cash_flow),
    ev_to_free_cash_flow: num(row.ev_to_free_cash_flow),
    ev_to_ebitda: num(row.ev_to_ebitda),
    net_debt_to_ebitda: num(row.net_debt_to_ebitda),
    income_quality: num(row.income_quality),
    graham_number: num(row.graham_number),
    graham_net_net: 0,
    tax_burden: 0,
    interest_burden: 0,
    working_capital: num(row.working_capital),
    invested_capital: num(row.invested_capital),
    return_on_assets: num(row.return_on_assets),
    operating_return_on_assets: 0,
    return_on_tangible_assets: 0,
    return_on_capital_employed: num(row.return_on_capital_employed),
    earnings_yield: num(row.earnings_yield),
    free_cash_flow_yield: num(row.free_cash_flow_yield),
    capex_to_operating_cash_flow: 0,
    capex_to_depreciation: 0,
    capex_to_revenue: num(row.capex_to_revenue),
    sga_to_revenue: 0,
    rd_to_revenue: num(row.research_and_development_to_revenue),
    sbc_to_revenue: num(row.stock_based_compensation_to_revenue),
    intangibles_to_total_assets: 0,
    average_receivables: 0,
    average_payables: 0,
    average_inventory: 0,
    days_sales_outstanding: num(row.days_of_sales_outstanding),
    days_payables_outstanding: num(row.days_of_payables_outstanding),
    days_inventory_outstanding: num(row.days_of_inventory_outstanding),
    operating_cycle: 0,
    cash_conversion_cycle: num(row.cash_conversion_cycle),
    free_cash_flow_to_equity: 0,
    free_cash_flow_to_firm: 0,
    tangible_asset_value: num(row.tangible_asset_value),
    net_current_asset_value: 0,

    // Ratios endpoint fields
    gross_profit_margin: num(row.gross_profit_margin),
    ebit_margin: num(row.ebit_margin),
    ebitda_margin: num(row.ebitda_margin),
    operating_profit_margin: num(row.operating_profit_margin),
    pretax_profit_margin: num(row.pretax_profit_margin),
    continuous_operations_profit_margin: 0,
    net_profit_margin: num(row.net_profit_margin),
    bottom_line_profit_margin: 0,
    receivables_turnover: num(row.receivables_turnover),
    payables_turnover: 0,
    inventory_turnover: num(row.inventory_turnover),
    fixed_asset_turnover: 0,
    asset_turnover: num(row.asset_turnover),
    quick_ratio: num(row.quick_ratio),
    solvency_ratio: 0,
    cash_ratio: num(row.cash_ratio),
    peg_ratio: num(row.price_to_earnings_growth_ratio),
    forward_peg_ratio: 0,
    price_to_fcf_ratio: num(row.price_to_free_cash_flow_ratio),
    price_to_ocf_ratio: num(row.price_to_operating_cash_flow_ratio),
    debt_to_assets_ratio: num(row.debt_to_assets_ratio),
    debt_to_capital_ratio: num(row.debt_to_capital_ratio),
    lt_debt_to_capital_ratio: 0,
    financial_leverage_ratio: num(row.financial_leverage_ratio),
    working_capital_turnover_ratio: 0,
    operating_cash_flow_ratio: 0,
    operating_cash_flow_sales_ratio: num(row.operating_cash_flow_sales_ratio),
    fcf_to_ocf_ratio: num(row.free_cash_flow_operating_cash_flow_ratio),
    debt_service_coverage_ratio: 0,
    interest_coverage_ratio: num(row.interest_coverage_ratio),
    short_term_ocf_coverage_ratio: 0,
    ocf_coverage_ratio: 0,
    capex_coverage_ratio: 0,
    div_capex_coverage_ratio: 0,
    dividend_yield_percentage: num(row.dividend_yield_percentage),
    interest_debt_per_share: 0,
    cash_per_share: num(row.cash_per_share),
    book_value_per_share: num(row.book_value_per_share),
    tangible_book_value_per_share: num(row.tangible_book_value_per_share),
    shareholders_equity_per_share: 0,
    operating_cash_flow_per_share: num(row.operating_cash_flow_per_share),
    capex_per_share: 0,
    net_income_per_ebt: 0,
    ebt_per_ebit: 0,
    price_to_fair_value: num(row.price_to_fair_value),
    debt_to_market_cap: num(row.debt_to_market_cap),
    effective_tax_rate: num(row.effective_tax_rate),
    enterprise_value_multiple: num(row.enterprise_value_multiple),
  };
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Public API — same signatures as before
// ---------------------------------------------------------------------------

/**
 * Returns cached stock universe from the database.
 * Uses 10-minute in-memory cache to avoid redundant DB queries.
 */
export async function getStockUniverse(): Promise<StockData[]> {
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
 * re-queries the database.
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
