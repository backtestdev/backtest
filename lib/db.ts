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
      -- Existing columns (from original schema)
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
      -- Key Metrics endpoint fields
      ev_to_operating_cash_flow NUMERIC DEFAULT 0,
      ev_to_free_cash_flow NUMERIC DEFAULT 0,
      ev_to_ebitda NUMERIC DEFAULT 0,
      net_debt_to_ebitda NUMERIC DEFAULT 0,
      income_quality NUMERIC DEFAULT 0,
      graham_number NUMERIC DEFAULT 0,
      graham_net_net NUMERIC DEFAULT 0,
      tax_burden NUMERIC DEFAULT 0,
      interest_burden NUMERIC DEFAULT 0,
      working_capital NUMERIC DEFAULT 0,
      invested_capital NUMERIC DEFAULT 0,
      return_on_assets NUMERIC DEFAULT 0,
      operating_return_on_assets NUMERIC DEFAULT 0,
      return_on_tangible_assets NUMERIC DEFAULT 0,
      return_on_capital_employed NUMERIC DEFAULT 0,
      free_cash_flow_yield NUMERIC DEFAULT 0,
      capex_to_operating_cash_flow NUMERIC DEFAULT 0,
      capex_to_depreciation NUMERIC DEFAULT 0,
      capex_to_revenue NUMERIC DEFAULT 0,
      sga_to_revenue NUMERIC DEFAULT 0,
      rd_to_revenue NUMERIC DEFAULT 0,
      sbc_to_revenue NUMERIC DEFAULT 0,
      intangibles_to_total_assets NUMERIC DEFAULT 0,
      average_receivables NUMERIC DEFAULT 0,
      average_payables NUMERIC DEFAULT 0,
      average_inventory NUMERIC DEFAULT 0,
      days_sales_outstanding NUMERIC DEFAULT 0,
      days_payables_outstanding NUMERIC DEFAULT 0,
      days_inventory_outstanding NUMERIC DEFAULT 0,
      operating_cycle NUMERIC DEFAULT 0,
      cash_conversion_cycle NUMERIC DEFAULT 0,
      free_cash_flow_to_equity NUMERIC DEFAULT 0,
      free_cash_flow_to_firm NUMERIC DEFAULT 0,
      tangible_asset_value NUMERIC DEFAULT 0,
      net_current_asset_value NUMERIC DEFAULT 0,
      -- Ratios endpoint fields
      gross_profit_margin NUMERIC DEFAULT 0,
      ebit_margin NUMERIC DEFAULT 0,
      ebitda_margin NUMERIC DEFAULT 0,
      operating_profit_margin NUMERIC DEFAULT 0,
      pretax_profit_margin NUMERIC DEFAULT 0,
      continuous_operations_profit_margin NUMERIC DEFAULT 0,
      net_profit_margin NUMERIC DEFAULT 0,
      bottom_line_profit_margin NUMERIC DEFAULT 0,
      receivables_turnover NUMERIC DEFAULT 0,
      payables_turnover NUMERIC DEFAULT 0,
      inventory_turnover NUMERIC DEFAULT 0,
      fixed_asset_turnover NUMERIC DEFAULT 0,
      asset_turnover NUMERIC DEFAULT 0,
      quick_ratio NUMERIC DEFAULT 0,
      solvency_ratio NUMERIC DEFAULT 0,
      cash_ratio NUMERIC DEFAULT 0,
      peg_ratio NUMERIC DEFAULT 0,
      forward_peg_ratio NUMERIC DEFAULT 0,
      price_to_fcf_ratio NUMERIC DEFAULT 0,
      price_to_ocf_ratio NUMERIC DEFAULT 0,
      debt_to_assets_ratio NUMERIC DEFAULT 0,
      debt_to_capital_ratio NUMERIC DEFAULT 0,
      lt_debt_to_capital_ratio NUMERIC DEFAULT 0,
      financial_leverage_ratio NUMERIC DEFAULT 0,
      working_capital_turnover_ratio NUMERIC DEFAULT 0,
      operating_cash_flow_ratio NUMERIC DEFAULT 0,
      operating_cash_flow_sales_ratio NUMERIC DEFAULT 0,
      fcf_to_ocf_ratio NUMERIC DEFAULT 0,
      debt_service_coverage_ratio NUMERIC DEFAULT 0,
      interest_coverage_ratio NUMERIC DEFAULT 0,
      short_term_ocf_coverage_ratio NUMERIC DEFAULT 0,
      ocf_coverage_ratio NUMERIC DEFAULT 0,
      capex_coverage_ratio NUMERIC DEFAULT 0,
      div_capex_coverage_ratio NUMERIC DEFAULT 0,
      dividend_yield_percentage NUMERIC DEFAULT 0,
      interest_debt_per_share NUMERIC DEFAULT 0,
      cash_per_share NUMERIC DEFAULT 0,
      book_value_per_share NUMERIC DEFAULT 0,
      tangible_book_value_per_share NUMERIC DEFAULT 0,
      shareholders_equity_per_share NUMERIC DEFAULT 0,
      operating_cash_flow_per_share NUMERIC DEFAULT 0,
      capex_per_share NUMERIC DEFAULT 0,
      net_income_per_ebt NUMERIC DEFAULT 0,
      ebt_per_ebit NUMERIC DEFAULT 0,
      price_to_fair_value NUMERIC DEFAULT 0,
      debt_to_market_cap NUMERIC DEFAULT 0,
      effective_tax_rate NUMERIC DEFAULT 0,
      enterprise_value_multiple NUMERIC DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Migration: add new columns to existing ratios tables
  await sql`
    DO $$ BEGIN
      -- Key Metrics endpoint fields
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS ev_to_operating_cash_flow NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS ev_to_free_cash_flow NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS ev_to_ebitda NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS net_debt_to_ebitda NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS income_quality NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS graham_number NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS graham_net_net NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS tax_burden NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS interest_burden NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS working_capital NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS invested_capital NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS return_on_assets NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS operating_return_on_assets NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS return_on_tangible_assets NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS return_on_capital_employed NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS free_cash_flow_yield NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS capex_to_operating_cash_flow NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS capex_to_depreciation NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS capex_to_revenue NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS sga_to_revenue NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS rd_to_revenue NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS sbc_to_revenue NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS intangibles_to_total_assets NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS average_receivables NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS average_payables NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS average_inventory NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS days_sales_outstanding NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS days_payables_outstanding NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS days_inventory_outstanding NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS operating_cycle NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS cash_conversion_cycle NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS free_cash_flow_to_equity NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS free_cash_flow_to_firm NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS tangible_asset_value NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS net_current_asset_value NUMERIC DEFAULT 0;
      -- Ratios endpoint fields
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS gross_profit_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS ebit_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS ebitda_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS operating_profit_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS pretax_profit_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS continuous_operations_profit_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS net_profit_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS bottom_line_profit_margin NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS receivables_turnover NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS payables_turnover NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS inventory_turnover NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS fixed_asset_turnover NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS asset_turnover NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS quick_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS solvency_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS cash_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS peg_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS forward_peg_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS price_to_fcf_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS price_to_ocf_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS debt_to_assets_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS debt_to_capital_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS lt_debt_to_capital_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS financial_leverage_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS working_capital_turnover_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS operating_cash_flow_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS operating_cash_flow_sales_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS fcf_to_ocf_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS debt_service_coverage_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS interest_coverage_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS short_term_ocf_coverage_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS ocf_coverage_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS capex_coverage_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS div_capex_coverage_ratio NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS dividend_yield_percentage NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS interest_debt_per_share NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS cash_per_share NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS book_value_per_share NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS tangible_book_value_per_share NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS shareholders_equity_per_share NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS operating_cash_flow_per_share NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS capex_per_share NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS net_income_per_ebt NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS ebt_per_ebit NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS price_to_fair_value NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS debt_to_market_cap NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS effective_tax_rate NUMERIC DEFAULT 0;
      ALTER TABLE ratios ADD COLUMN IF NOT EXISTS enterprise_value_multiple NUMERIC DEFAULT 0;
    END $$
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
