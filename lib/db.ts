import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { createHash } from "crypto";

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }
  return neon(databaseUrl);
}

/**
 * Creates the unified stocks table, stock_prices, and stock_meta tables
 * with indexes if they don't exist.
 * Safe to call repeatedly (all statements are IF NOT EXISTS).
 *
 * NOTE: This does NOT create the leaderboard table - that is handled
 * separately to maintain backward compatibility with existing data.
 */
export async function ensureStockTables(sql: NeonQueryFunction<false, false>) {
  // Unified stocks table - one row per stock, all metrics in one place
  await sql`
    CREATE TABLE IF NOT EXISTS stocks (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10) UNIQUE NOT NULL,
      company_name VARCHAR(255),
      sector VARCHAR(100),
      industry VARCHAR(100),
      market_cap NUMERIC,
      price DECIMAL(12,4),
      beta DECIMAL(8,4),
      volume NUMERIC,
      avg_volume NUMERIC,
      last_dividend DECIMAL(8,4),
      ipo_date DATE,
      year_high DECIMAL(12,4),
      year_low DECIMAL(12,4),
      is_etf BOOLEAN DEFAULT FALSE,
      is_actively_trading BOOLEAN DEFAULT TRUE,

      -- VALUATION
      price_to_earnings_ratio DECIMAL(16,8),
      price_to_earnings_growth_ratio DECIMAL(16,8),
      price_to_book_ratio DECIMAL(16,8),
      price_to_sales_ratio DECIMAL(16,8),
      price_to_free_cash_flow_ratio DECIMAL(16,8),
      price_to_operating_cash_flow_ratio DECIMAL(16,8),
      price_to_fair_value DECIMAL(16,8),
      enterprise_value_multiple DECIMAL(16,8),

      -- PROFITABILITY
      gross_profit_margin DECIMAL(16,8),
      ebit_margin DECIMAL(16,8),
      ebitda_margin DECIMAL(16,8),
      operating_profit_margin DECIMAL(16,8),
      pretax_profit_margin DECIMAL(16,8),
      net_profit_margin DECIMAL(16,8),
      effective_tax_rate DECIMAL(16,8),

      -- RETURNS
      return_on_assets DECIMAL(16,8),
      return_on_equity DECIMAL(16,8),
      return_on_invested_capital DECIMAL(16,8),
      return_on_capital_employed DECIMAL(16,8),
      earnings_yield DECIMAL(16,8),
      free_cash_flow_yield DECIMAL(16,8),

      -- LIQUIDITY & SOLVENCY
      current_ratio DECIMAL(16,8),
      quick_ratio DECIMAL(16,8),
      cash_ratio DECIMAL(16,8),

      -- LEVERAGE/DEBT
      debt_to_equity_ratio DECIMAL(16,8),
      debt_to_assets_ratio DECIMAL(16,8),
      debt_to_capital_ratio DECIMAL(16,8),
      financial_leverage_ratio DECIMAL(16,8),
      debt_to_market_cap DECIMAL(16,8),
      interest_coverage_ratio DECIMAL(16,8),

      -- DIVIDENDS
      dividend_yield DECIMAL(16,8),
      dividend_yield_percentage DECIMAL(16,8),
      dividend_payout_ratio DECIMAL(16,8),

      -- PER SHARE
      revenue_per_share DECIMAL(16,8),
      net_income_per_share DECIMAL(16,8),
      book_value_per_share DECIMAL(16,8),
      tangible_book_value_per_share DECIMAL(16,8),
      operating_cash_flow_per_share DECIMAL(16,8),
      free_cash_flow_per_share DECIMAL(16,8),
      cash_per_share DECIMAL(16,8),

      -- EFFICIENCY
      asset_turnover DECIMAL(16,8),
      inventory_turnover DECIMAL(16,8),
      receivables_turnover DECIMAL(16,8),
      days_of_sales_outstanding DECIMAL(16,8),
      days_of_inventory_outstanding DECIMAL(16,8),
      days_of_payables_outstanding DECIMAL(16,8),
      cash_conversion_cycle DECIMAL(16,8),

      -- ENTERPRISE VALUE
      enterprise_value NUMERIC,
      ev_to_sales DECIMAL(16,8),
      ev_to_ebitda DECIMAL(16,8),
      ev_to_operating_cash_flow DECIMAL(16,8),
      ev_to_free_cash_flow DECIMAL(16,8),
      net_debt_to_ebitda DECIMAL(16,8),

      -- CASH FLOW
      capex_to_revenue DECIMAL(16,8),
      free_cash_flow_operating_cash_flow_ratio DECIMAL(16,8),
      operating_cash_flow_sales_ratio DECIMAL(16,8),
      income_quality DECIMAL(16,8),

      -- OTHER
      graham_number DECIMAL(16,8),
      working_capital NUMERIC,
      invested_capital NUMERIC,
      tangible_asset_value NUMERIC,
      research_and_development_to_revenue DECIMAL(16,8),
      stock_based_compensation_to_revenue DECIMAL(16,8),

      -- TREND DATA (computed from income-statement API)
      consecutive_revenue_growth_years INT DEFAULT 0,
      consecutive_net_income_growth_years INT DEFAULT 0,
      consecutive_dividend_growth_years INT DEFAULT 0,
      consecutive_eps_growth_years INT DEFAULT 0,
      revenue_growth_3yr_avg DECIMAL(16,8),
      net_income_growth_3yr_avg DECIMAL(16,8),
      revenue_growth_yoy DECIMAL(16,8),
      earnings_growth_yoy DECIMAL(16,8),
      eps_growth_yoy DECIMAL(16,8),
      revenue_growth_positive_3yr_count INT DEFAULT 0,
      latest_fiscal_date DATE,

      -- SCORE (persisted by refresh-signals for monitoring & staleness detection)
      quant_score INTEGER,
      score_updated_at TIMESTAMPTZ,

      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Indexes on the unified stocks table
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_industry ON stocks(industry)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_market_cap ON stocks(market_cap)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_pe ON stocks(price_to_earnings_ratio)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_pb ON stocks(price_to_book_ratio)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_div_yield ON stocks(dividend_yield)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_roe ON stocks(return_on_equity)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_price ON stocks(price)`;

  // Migrate any existing BIGINT columns to NUMERIC (handles decimal values from FMP)
  await sql`
    DO $$
    BEGIN
      ALTER TABLE stocks ALTER COLUMN market_cap TYPE NUMERIC USING market_cap::NUMERIC;
      ALTER TABLE stocks ALTER COLUMN volume TYPE NUMERIC USING volume::NUMERIC;
      ALTER TABLE stocks ALTER COLUMN avg_volume TYPE NUMERIC USING avg_volume::NUMERIC;
      ALTER TABLE stocks ALTER COLUMN enterprise_value TYPE NUMERIC USING enterprise_value::NUMERIC;
      ALTER TABLE stocks ALTER COLUMN working_capital TYPE NUMERIC USING working_capital::NUMERIC;
      ALTER TABLE stocks ALTER COLUMN invested_capital TYPE NUMERIC USING invested_capital::NUMERIC;
      ALTER TABLE stocks ALTER COLUMN tangible_asset_value TYPE NUMERIC USING tangible_asset_value::NUMERIC;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `;

  // Add columns that were added after initial table creation
  // (CREATE TABLE IF NOT EXISTS won't add new columns to existing tables)
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stocks' AND column_name='latest_fiscal_date') THEN
        ALTER TABLE stocks ADD COLUMN latest_fiscal_date DATE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stocks' AND column_name='revenue_growth_positive_3yr_count') THEN
        ALTER TABLE stocks ADD COLUMN revenue_growth_positive_3yr_count INT DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stocks' AND column_name='quant_score') THEN
        ALTER TABLE stocks ADD COLUMN quant_score INTEGER;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stocks' AND column_name='score_updated_at') THEN
        ALTER TABLE stocks ADD COLUMN score_updated_at TIMESTAMPTZ;
      END IF;
    END $$
  `;

  // Historical prices table (for charts)
  await sql`
    CREATE TABLE IF NOT EXISTS stock_prices (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10) NOT NULL,
      date DATE NOT NULL,
      close_price DECIMAL(12,4) NOT NULL,
      UNIQUE(symbol, date)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_prices_symbol_date ON stock_prices(symbol, date)`;

  // Precomputed annual returns from Yahoo Finance (for backtesting)
  await sql`
    CREATE TABLE IF NOT EXISTS stock_annual_returns (
      symbol VARCHAR(10) NOT NULL,
      year INT NOT NULL,
      annual_return DECIMAL(10,6) NOT NULL,
      year_end_close DECIMAL(12,4),
      PRIMARY KEY (symbol, year)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_annual_returns_symbol ON stock_annual_returns(symbol)`;

  // Stock metadata table
  await sql`
    CREATE TABLE IF NOT EXISTS stock_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/**
 * Creates the stocks_new table with the unified schema.
 * Used by the refresh-data endpoint to populate in the background
 * before atomically swapping with the live stocks table.
 */
export async function createStocksNewTable(sql: NeonQueryFunction<false, false>) {
  await sql`DROP TABLE IF EXISTS stocks_new`;
  await sql`
    CREATE TABLE stocks_new (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10) UNIQUE NOT NULL,
      company_name VARCHAR(255),
      sector VARCHAR(100),
      industry VARCHAR(100),
      market_cap NUMERIC,
      price DECIMAL(12,4),
      beta DECIMAL(8,4),
      volume NUMERIC,
      avg_volume NUMERIC,
      last_dividend DECIMAL(8,4),
      ipo_date DATE,
      year_high DECIMAL(12,4),
      year_low DECIMAL(12,4),
      is_etf BOOLEAN DEFAULT FALSE,
      is_actively_trading BOOLEAN DEFAULT TRUE,

      -- VALUATION
      price_to_earnings_ratio DECIMAL(16,8),
      price_to_earnings_growth_ratio DECIMAL(16,8),
      price_to_book_ratio DECIMAL(16,8),
      price_to_sales_ratio DECIMAL(16,8),
      price_to_free_cash_flow_ratio DECIMAL(16,8),
      price_to_operating_cash_flow_ratio DECIMAL(16,8),
      price_to_fair_value DECIMAL(16,8),
      enterprise_value_multiple DECIMAL(16,8),

      -- PROFITABILITY
      gross_profit_margin DECIMAL(16,8),
      ebit_margin DECIMAL(16,8),
      ebitda_margin DECIMAL(16,8),
      operating_profit_margin DECIMAL(16,8),
      pretax_profit_margin DECIMAL(16,8),
      net_profit_margin DECIMAL(16,8),
      effective_tax_rate DECIMAL(16,8),

      -- RETURNS
      return_on_assets DECIMAL(16,8),
      return_on_equity DECIMAL(16,8),
      return_on_invested_capital DECIMAL(16,8),
      return_on_capital_employed DECIMAL(16,8),
      earnings_yield DECIMAL(16,8),
      free_cash_flow_yield DECIMAL(16,8),

      -- LIQUIDITY & SOLVENCY
      current_ratio DECIMAL(16,8),
      quick_ratio DECIMAL(16,8),
      cash_ratio DECIMAL(16,8),

      -- LEVERAGE/DEBT
      debt_to_equity_ratio DECIMAL(16,8),
      debt_to_assets_ratio DECIMAL(16,8),
      debt_to_capital_ratio DECIMAL(16,8),
      financial_leverage_ratio DECIMAL(16,8),
      debt_to_market_cap DECIMAL(16,8),
      interest_coverage_ratio DECIMAL(16,8),

      -- DIVIDENDS
      dividend_yield DECIMAL(16,8),
      dividend_yield_percentage DECIMAL(16,8),
      dividend_payout_ratio DECIMAL(16,8),

      -- PER SHARE
      revenue_per_share DECIMAL(16,8),
      net_income_per_share DECIMAL(16,8),
      book_value_per_share DECIMAL(16,8),
      tangible_book_value_per_share DECIMAL(16,8),
      operating_cash_flow_per_share DECIMAL(16,8),
      free_cash_flow_per_share DECIMAL(16,8),
      cash_per_share DECIMAL(16,8),

      -- EFFICIENCY
      asset_turnover DECIMAL(16,8),
      inventory_turnover DECIMAL(16,8),
      receivables_turnover DECIMAL(16,8),
      days_of_sales_outstanding DECIMAL(16,8),
      days_of_inventory_outstanding DECIMAL(16,8),
      days_of_payables_outstanding DECIMAL(16,8),
      cash_conversion_cycle DECIMAL(16,8),

      -- ENTERPRISE VALUE
      enterprise_value NUMERIC,
      ev_to_sales DECIMAL(16,8),
      ev_to_ebitda DECIMAL(16,8),
      ev_to_operating_cash_flow DECIMAL(16,8),
      ev_to_free_cash_flow DECIMAL(16,8),
      net_debt_to_ebitda DECIMAL(16,8),

      -- CASH FLOW
      capex_to_revenue DECIMAL(16,8),
      free_cash_flow_operating_cash_flow_ratio DECIMAL(16,8),
      operating_cash_flow_sales_ratio DECIMAL(16,8),
      income_quality DECIMAL(16,8),

      -- OTHER
      graham_number DECIMAL(16,8),
      working_capital NUMERIC,
      invested_capital NUMERIC,
      tangible_asset_value NUMERIC,
      research_and_development_to_revenue DECIMAL(16,8),
      stock_based_compensation_to_revenue DECIMAL(16,8),

      -- TREND DATA
      consecutive_revenue_growth_years INT DEFAULT 0,
      consecutive_net_income_growth_years INT DEFAULT 0,
      consecutive_dividend_growth_years INT DEFAULT 0,
      consecutive_eps_growth_years INT DEFAULT 0,
      revenue_growth_3yr_avg DECIMAL(16,8),
      net_income_growth_3yr_avg DECIMAL(16,8),
      revenue_growth_yoy DECIMAL(16,8),
      earnings_growth_yoy DECIMAL(16,8),
      eps_growth_yoy DECIMAL(16,8),
      revenue_growth_positive_3yr_count INT DEFAULT 0,
      latest_fiscal_date DATE,

      -- SCORE
      quant_score INTEGER,
      score_updated_at TIMESTAMPTZ,

      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

/**
 * Ensures the leaderboard table exists with the current schema.
 * Handles migration of older schemas by adding missing columns.
 */
export async function ensureLeaderboardTable(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      return1yr NUMERIC DEFAULT 0,
      return5yr NUMERIC DEFAULT 0,
      return10yr NUMERIC DEFAULT 0,
      return20yr NUMERIC DEFAULT 0,
      matched_stocks INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      user_id TEXT,
      parameters_json JSONB,
      parameters_hash TEXT,
      query_hash TEXT,
      created_by TEXT
    )
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaderboard' AND column_name='parameters_json') THEN
        ALTER TABLE leaderboard ADD COLUMN parameters_json JSONB;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaderboard' AND column_name='parameters_hash') THEN
        ALTER TABLE leaderboard ADD COLUMN parameters_hash TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaderboard' AND column_name='query_hash') THEN
        ALTER TABLE leaderboard ADD COLUMN query_hash TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaderboard' AND column_name='created_by') THEN
        ALTER TABLE leaderboard ADD COLUMN created_by TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaderboard' AND column_name='is_public') THEN
        ALTER TABLE leaderboard ADD COLUMN is_public BOOLEAN DEFAULT TRUE;
      END IF;
    END $$
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_params_hash ON leaderboard (parameters_hash)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_query_hash ON leaderboard (query_hash)
  `;
}

/**
 * Ensures the saved_portfolios table exists.
 */
export async function ensureSavedPortfoliosTable(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS saved_portfolios (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      holdings JSONB NOT NULL,
      analysis JSONB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_saved_portfolios_user ON saved_portfolios(user_id)`;
}

/**
 * Ensures the signal_picks table exists for the Signal Tracker module.
 */
export async function ensureSignalPicksTable(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS signal_picks (
      id TEXT PRIMARY KEY,
      symbol VARCHAR(10) NOT NULL,
      company_name VARCHAR(255),
      sector VARCHAR(100),
      market_cap_at_pick NUMERIC,
      score INTEGER NOT NULL,
      thesis TEXT,
      pick_date DATE NOT NULL,
      entry_price DECIMAL(12,4),
      status VARCHAR(20) DEFAULT 'active',
      sell_date DATE,
      sell_price DECIMAL(12,4),
      sell_reason TEXT,
      deep_thesis TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_signal_picks_symbol ON signal_picks(symbol)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signal_picks_status ON signal_picks(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signal_picks_date ON signal_picks(pick_date)`;
  // Add deep_thesis column if missing (migration for existing tables)
  await sql`ALTER TABLE signal_picks ADD COLUMN IF NOT EXISTS deep_thesis TEXT`.catch(() => {});
}

/**
 * Ensures the signal_rebalances table exists for tracking periodic position top-ups.
 * When cash reserve exceeds 30% of fund value, the system reallocates to active picks.
 */
export async function ensureSignalRebalancesTable(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS signal_rebalances (
      id TEXT PRIMARY KEY,
      rebalance_date DATE NOT NULL,
      pick_id TEXT NOT NULL REFERENCES signal_picks(id),
      symbol VARCHAR(10) NOT NULL,
      add_amount DECIMAL(12,2) NOT NULL,
      add_shares DECIMAL(12,4) NOT NULL,
      price_at_rebalance DECIMAL(12,4) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_signal_rebalances_date ON signal_rebalances(rebalance_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signal_rebalances_pick ON signal_rebalances(pick_id)`;
}

/**
 * Ensures the signal_score_history table exists for tracking score snapshots over time.
 * Recorded monthly (1st of each month) by the refresh-signals cron job for all stocks.
 */
export async function ensureSignalScoreHistoryTable(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS signal_score_history (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10) NOT NULL,
      score INTEGER NOT NULL,
      recorded_at DATE NOT NULL,
      UNIQUE(symbol, recorded_at)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_score_history_symbol ON signal_score_history(symbol)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_score_history_date ON signal_score_history(recorded_at)`;
}

/**
 * Ensures the user_usage table exists for tracking backtest usage per month.
 */
export async function ensureUserUsageTable(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS user_usage (
      user_id TEXT NOT NULL,
      usage_month TEXT NOT NULL,
      backtest_count INT DEFAULT 0,
      PRIMARY KEY (user_id, usage_month)
    )
  `;
}

export function generateParametersHash(params: unknown): string {
  const sortedJson = JSON.stringify(params, Object.keys(params as Record<string, unknown>).sort());
  return createHash("sha256").update(sortedJson).digest("hex").slice(0, 16);
}

/**
 * Hash the user's original query text (normalized) for dedup of
 * non-deterministic strategies like ticker-mode ("meme stocks").
 * Two runs of the same prompt should produce the same query_hash
 * even if the AI returns different ticker lists.
 */
export function generateQueryHash(query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Drops legacy tables (profiles, ratios) and unused columns from stocks table
 * to reclaim Neon storage. Safe to call repeatedly — all operations are idempotent.
 */
export async function dropUnusedColumnsAndTables(sql: NeonQueryFunction<false, false>) {
  const dropped: string[] = [];

  // Drop legacy tables that are no longer used by the codebase
  for (const table of ['profiles', 'ratios']) {
    try {
      const exists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = ${table} AND table_schema = 'public'
        ) as exists
      `;
      if (exists[0]?.exists) {
        await sql.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        dropped.push(`table:${table}`);
      }
    } catch { /* ignore */ }
  }

  // Drop unused columns from stocks table to reclaim storage
  // These columns were never read by application code
  const unusedColumns = [
    'exchange', 'country', 'description', 'full_time_employees', 'is_fund',
    'revenue_history', 'net_income_history', 'eps_history',
    'revenue_growth_5yr_avg', 'net_income_growth_5yr_avg',
    'net_income_growth_positive_3yr_count',
  ];

  for (const col of unusedColumns) {
    try {
      const colExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'stocks' AND column_name = ${col}
        ) as exists
      `;
      if (colExists[0]?.exists) {
        await sql.query(`ALTER TABLE stocks DROP COLUMN IF EXISTS ${col}`);
        dropped.push(`column:stocks.${col}`);
      }
    } catch { /* ignore - column may already be gone */ }
  }

  if (dropped.length > 0) {
    console.log(`[db-cleanup] Dropped: ${dropped.join(', ')}`);
  }

  return { dropped };
}
