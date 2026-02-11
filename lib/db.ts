import { neon, NeonQueryFunction } from "@neondatabase/serverless";

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }
  return neon(databaseUrl);
}

/**
 * Creates all stock-related tables + indexes if they don't exist.
 * Safe to call repeatedly (all statements are IF NOT EXISTS).
 */
export async function ensureStockTables(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS stocks (
      symbol TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      country TEXT,
      exchange TEXT,
      exchange_short_name TEXT,
      market_cap BIGINT DEFAULT 0,
      beta NUMERIC DEFAULT 0,
      last_annual_dividend NUMERIC DEFAULT 0,
      is_etf BOOLEAN DEFAULT false,
      is_actively_trading BOOLEAN DEFAULT true,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS quotes (
      symbol TEXT PRIMARY KEY REFERENCES stocks(symbol) ON DELETE CASCADE,
      price NUMERIC DEFAULT 0,
      changes_percentage NUMERIC DEFAULT 0,
      day_low NUMERIC DEFAULT 0,
      day_high NUMERIC DEFAULT 0,
      year_high NUMERIC DEFAULT 0,
      year_low NUMERIC DEFAULT 0,
      market_cap BIGINT DEFAULT 0,
      price_avg_50 NUMERIC DEFAULT 0,
      price_avg_200 NUMERIC DEFAULT 0,
      volume BIGINT DEFAULT 0,
      avg_volume BIGINT DEFAULT 0,
      eps NUMERIC DEFAULT 0,
      pe NUMERIC DEFAULT 0,
      shares_outstanding BIGINT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ratios (
      symbol TEXT PRIMARY KEY REFERENCES stocks(symbol) ON DELETE CASCADE,
      pe_ratio NUMERIC DEFAULT 0,
      pb_ratio NUMERIC DEFAULT 0,
      price_to_sales_ratio NUMERIC DEFAULT 0,
      debt_to_equity NUMERIC DEFAULT 0,
      current_ratio NUMERIC DEFAULT 0,
      roe NUMERIC DEFAULT 0,
      roic NUMERIC DEFAULT 0,
      dividend_yield NUMERIC DEFAULT 0,
      payout_ratio NUMERIC DEFAULT 0,
      free_cash_flow_per_share NUMERIC DEFAULT 0,
      revenue_per_share NUMERIC DEFAULT 0,
      net_income_per_share NUMERIC DEFAULT 0,
      earnings_yield NUMERIC DEFAULT 0,
      ev_to_sales NUMERIC DEFAULT 0,
      enterprise_value BIGINT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS profiles (
      symbol TEXT PRIMARY KEY REFERENCES stocks(symbol) ON DELETE CASCADE,
      revenue_growth NUMERIC DEFAULT 0,
      net_income_growth NUMERIC DEFAULT 0,
      earnings_growth NUMERIC DEFAULT 0,
      revenue_growth_quarters INTEGER DEFAULT 0,
      net_income_growth_quarters INTEGER DEFAULT 0,
      dividend_growth_years INTEGER DEFAULT 0,
      profit_margin NUMERIC DEFAULT 0,
      historical_returns JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS stock_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Indexes for fast filtering
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_market_cap ON stocks(market_cap)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange_short_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_quotes_pe ON quotes(pe)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_quotes_market_cap ON quotes(market_cap)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ratios_pe ON ratios(pe_ratio)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ratios_dividend ON ratios(dividend_yield)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ratios_roe ON ratios(roe)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ratios_debt ON ratios(debt_to_equity)`;
}

export function generateParametersHash(params: unknown): string {
  // Create a deterministic string from sorted JSON
  const sortedJson = JSON.stringify(params, Object.keys(params as Record<string, unknown>).sort());
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < sortedJson.length; i++) {
    const char = sortedJson.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}
