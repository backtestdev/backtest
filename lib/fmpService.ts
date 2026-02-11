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
        q.eps,
        q.year_high,
        q.market_cap  AS q_market_cap,
        q.shares_outstanding,

        r.pe_ratio,
        r.pb_ratio,
        r.price_to_sales_ratio,
        r.dividend_yield,
        r.payout_ratio,
        r.roe,
        r.roic,
        r.debt_to_equity,
        r.current_ratio,
        r.free_cash_flow_per_share,
        r.revenue_per_share,
        r.net_income_per_share,
        r.earnings_yield,
        r.enterprise_value,
        r.ev_to_sales,
        -- Key Metrics fields
        r.ev_to_operating_cash_flow,
        r.ev_to_free_cash_flow,
        r.ev_to_ebitda,
        r.net_debt_to_ebitda,
        r.income_quality,
        r.graham_number,
        r.graham_net_net,
        r.tax_burden,
        r.interest_burden,
        r.working_capital,
        r.invested_capital,
        r.return_on_assets,
        r.operating_return_on_assets,
        r.return_on_tangible_assets,
        r.return_on_capital_employed,
        r.free_cash_flow_yield,
        r.capex_to_operating_cash_flow,
        r.capex_to_depreciation,
        r.capex_to_revenue,
        r.sga_to_revenue,
        r.rd_to_revenue,
        r.sbc_to_revenue,
        r.intangibles_to_total_assets,
        r.average_receivables,
        r.average_payables,
        r.average_inventory,
        r.days_sales_outstanding,
        r.days_payables_outstanding,
        r.days_inventory_outstanding,
        r.operating_cycle,
        r.cash_conversion_cycle,
        r.free_cash_flow_to_equity,
        r.free_cash_flow_to_firm,
        r.tangible_asset_value,
        r.net_current_asset_value,
        -- Ratios endpoint fields
        r.gross_profit_margin,
        r.ebit_margin,
        r.ebitda_margin,
        r.operating_profit_margin,
        r.pretax_profit_margin,
        r.continuous_operations_profit_margin,
        r.net_profit_margin,
        r.bottom_line_profit_margin,
        r.receivables_turnover,
        r.payables_turnover,
        r.inventory_turnover,
        r.fixed_asset_turnover,
        r.asset_turnover,
        r.quick_ratio,
        r.solvency_ratio,
        r.cash_ratio,
        r.peg_ratio,
        r.forward_peg_ratio,
        r.price_to_fcf_ratio,
        r.price_to_ocf_ratio,
        r.debt_to_assets_ratio,
        r.debt_to_capital_ratio,
        r.lt_debt_to_capital_ratio,
        r.financial_leverage_ratio,
        r.working_capital_turnover_ratio,
        r.operating_cash_flow_ratio,
        r.operating_cash_flow_sales_ratio,
        r.fcf_to_ocf_ratio,
        r.debt_service_coverage_ratio,
        r.interest_coverage_ratio,
        r.short_term_ocf_coverage_ratio,
        r.ocf_coverage_ratio,
        r.capex_coverage_ratio,
        r.div_capex_coverage_ratio,
        r.dividend_yield_percentage,
        r.interest_debt_per_share,
        r.cash_per_share,
        r.book_value_per_share,
        r.tangible_book_value_per_share,
        r.shareholders_equity_per_share,
        r.operating_cash_flow_per_share,
        r.capex_per_share,
        r.net_income_per_ebt,
        r.ebt_per_ebit,
        r.price_to_fair_value,
        r.debt_to_market_cap,
        r.effective_tax_rate,
        r.enterprise_value_multiple,

        p.revenue_growth,
        p.earnings_growth,
        p.revenue_growth_quarters,
        p.net_income_growth_quarters,
        p.dividend_growth_years,
        p.profit_margin,
        p.historical_returns
      FROM stocks s
      INNER JOIN quotes   q ON q.symbol = s.symbol
      INNER JOIN ratios   r ON r.symbol = s.symbol
      INNER JOIN profiles p ON p.symbol = s.symbol
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

    // PE: prefer ratios table, fall back to quote
    pe_ratio: num(row.pe_ratio) || num(row.pe),
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

    revenue_per_share: num(row.revenue_per_share),
    net_income_per_share: num(row.net_income_per_share),

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

    // Key Metrics endpoint fields
    enterprise_value: num(row.enterprise_value),
    ev_to_sales: num(row.ev_to_sales),
    ev_to_operating_cash_flow: num(row.ev_to_operating_cash_flow),
    ev_to_free_cash_flow: num(row.ev_to_free_cash_flow),
    ev_to_ebitda: num(row.ev_to_ebitda),
    net_debt_to_ebitda: num(row.net_debt_to_ebitda),
    income_quality: num(row.income_quality),
    graham_number: num(row.graham_number),
    graham_net_net: num(row.graham_net_net),
    tax_burden: num(row.tax_burden),
    interest_burden: num(row.interest_burden),
    working_capital: num(row.working_capital),
    invested_capital: num(row.invested_capital),
    return_on_assets: num(row.return_on_assets),
    operating_return_on_assets: num(row.operating_return_on_assets),
    return_on_tangible_assets: num(row.return_on_tangible_assets),
    return_on_capital_employed: num(row.return_on_capital_employed),
    earnings_yield: num(row.earnings_yield),
    free_cash_flow_yield: num(row.free_cash_flow_yield),
    capex_to_operating_cash_flow: num(row.capex_to_operating_cash_flow),
    capex_to_depreciation: num(row.capex_to_depreciation),
    capex_to_revenue: num(row.capex_to_revenue),
    sga_to_revenue: num(row.sga_to_revenue),
    rd_to_revenue: num(row.rd_to_revenue),
    sbc_to_revenue: num(row.sbc_to_revenue),
    intangibles_to_total_assets: num(row.intangibles_to_total_assets),
    average_receivables: num(row.average_receivables),
    average_payables: num(row.average_payables),
    average_inventory: num(row.average_inventory),
    days_sales_outstanding: num(row.days_sales_outstanding),
    days_payables_outstanding: num(row.days_payables_outstanding),
    days_inventory_outstanding: num(row.days_inventory_outstanding),
    operating_cycle: num(row.operating_cycle),
    cash_conversion_cycle: num(row.cash_conversion_cycle),
    free_cash_flow_to_equity: num(row.free_cash_flow_to_equity),
    free_cash_flow_to_firm: num(row.free_cash_flow_to_firm),
    tangible_asset_value: num(row.tangible_asset_value),
    net_current_asset_value: num(row.net_current_asset_value),

    // Ratios endpoint fields
    gross_profit_margin: num(row.gross_profit_margin),
    ebit_margin: num(row.ebit_margin),
    ebitda_margin: num(row.ebitda_margin),
    operating_profit_margin: num(row.operating_profit_margin),
    pretax_profit_margin: num(row.pretax_profit_margin),
    continuous_operations_profit_margin: num(row.continuous_operations_profit_margin),
    net_profit_margin: num(row.net_profit_margin),
    bottom_line_profit_margin: num(row.bottom_line_profit_margin),
    receivables_turnover: num(row.receivables_turnover),
    payables_turnover: num(row.payables_turnover),
    inventory_turnover: num(row.inventory_turnover),
    fixed_asset_turnover: num(row.fixed_asset_turnover),
    asset_turnover: num(row.asset_turnover),
    quick_ratio: num(row.quick_ratio),
    solvency_ratio: num(row.solvency_ratio),
    cash_ratio: num(row.cash_ratio),
    peg_ratio: num(row.peg_ratio),
    forward_peg_ratio: num(row.forward_peg_ratio),
    price_to_fcf_ratio: num(row.price_to_fcf_ratio),
    price_to_ocf_ratio: num(row.price_to_ocf_ratio),
    debt_to_assets_ratio: num(row.debt_to_assets_ratio),
    debt_to_capital_ratio: num(row.debt_to_capital_ratio),
    lt_debt_to_capital_ratio: num(row.lt_debt_to_capital_ratio),
    financial_leverage_ratio: num(row.financial_leverage_ratio),
    working_capital_turnover_ratio: num(row.working_capital_turnover_ratio),
    operating_cash_flow_ratio: num(row.operating_cash_flow_ratio),
    operating_cash_flow_sales_ratio: num(row.operating_cash_flow_sales_ratio),
    fcf_to_ocf_ratio: num(row.fcf_to_ocf_ratio),
    debt_service_coverage_ratio: num(row.debt_service_coverage_ratio),
    interest_coverage_ratio: num(row.interest_coverage_ratio),
    short_term_ocf_coverage_ratio: num(row.short_term_ocf_coverage_ratio),
    ocf_coverage_ratio: num(row.ocf_coverage_ratio),
    capex_coverage_ratio: num(row.capex_coverage_ratio),
    div_capex_coverage_ratio: num(row.div_capex_coverage_ratio),
    dividend_yield_percentage: num(row.dividend_yield_percentage),
    interest_debt_per_share: num(row.interest_debt_per_share),
    cash_per_share: num(row.cash_per_share),
    book_value_per_share: num(row.book_value_per_share),
    tangible_book_value_per_share: num(row.tangible_book_value_per_share),
    shareholders_equity_per_share: num(row.shareholders_equity_per_share),
    operating_cash_flow_per_share: num(row.operating_cash_flow_per_share),
    capex_per_share: num(row.capex_per_share),
    net_income_per_ebt: num(row.net_income_per_ebt),
    ebt_per_ebit: num(row.ebt_per_ebit),
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
